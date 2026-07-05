/**
 * Alchemy (Infrastructure as TypeScript) — Cloudflare + PlanetScale リソース定義
 *
 * PlanetScale の DB/Role 作成、Hyperdrive の作成、Worker のデプロイを
 * TypeScript 一枚で管理する（DB → 接続情報 → Hyperdrive → Worker が全自動）。
 * CI（deploy.yml）はこれを 2 段実行する:
 *   1) SKIP_WORKER=1 — DB/Role/Hyperdrive を作成し DATABASE_URL を GITHUB_ENV へ export
 *   2) drizzle-kit migrate（新コードが旧スキーマを踏まないよう Worker 更新より先に流す）
 *   3) SKIP_WORKER なし — Worker をデプロイ
 *
 * 使い方: docs/dev/alchemy-iac.md を参照
 *   bun run infra:deploy:staging   # ビルド + staging デプロイ
 *   bun run infra:destroy:staging  # staging リソース削除（DB 本体は削除されず state からのみ外れる）
 */
import { appendFileSync, existsSync } from "node:fs";

import alchemy from "alchemy";
import { Assets, Hyperdrive, Worker } from "alchemy/cloudflare";
import { Database, Role } from "alchemy/planetscale";
import { CloudflareStateStore } from "alchemy/state";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`環境変数 ${key} が未設定です（.env を確認してください）`);
  }
  return value;
}

const appName = requireEnv("APP_NAME");
if (appName.includes("{{")) {
  throw new Error("APP_NAME がテンプレートプレースホルダーのままです");
}

// state は CF アカウント上の Durable Object に置く（ローカルと CI で共有 — 使い捨ての
// CI ランナーでも state が失われない）。ALCHEMY_STATE_TOKEN は全実行環境で同一の値にすること。
requireEnv("ALCHEMY_STATE_TOKEN");
const app = await alchemy(appName, {
  stateStore: (scope) => new CloudflareStateStore(scope),
});

const stage = app.stage;
if (stage !== "staging" && stage !== "production") {
  throw new Error(`stage は staging | production のみ対応です（--stage で指定、現在: ${stage}）`);
}

// wrangler.jsonc の env 命名と揃える: staging は -staging サフィックス、production は素の名前
const workerName = stage === "production" ? appName : `${appName}-${stage}`;

// ---- PlanetScale (DB + Role) -------------------------------------------
// 認証はサービストークン（PLANETSCALE_SERVICE_TOKEN_ID / PLANETSCALE_SERVICE_TOKEN）。
// プロバイダは環境変数を暗黙参照するが、エラーを早期化するためここで検証する。
requireEnv("PLANETSCALE_SERVICE_TOKEN_ID");
requireEnv("PLANETSCALE_SERVICE_TOKEN");
const planetscaleOrg = requireEnv("PLANETSCALE_ORGANIZATION");

const database = await Database("database", {
  name: `${appName}-${stage}`,
  organization: planetscaleOrg,
  kind: "postgresql",
  clusterSize: "PS_5",
  // 0 = シングルノード（$5/月）。未指定だと PlanetScale デフォルトの HA（Primary+レプリカ2 = 3倍額）
  // で作られるため必ず明示する。本番を HA にしたくなったら 2 に上げる（create 時のみ有効。
  // 既存 DB はダッシュボードの Cluster 設定から変更する）
  replicas: 0,
  arch: "arm", // Graviton。x86 より価格性能比が良い
  region: { slug: "ap-northeast" }, // AWS Tokyo (ap-northeast-1)
  adopt: true,
  // delete はデフォルト false: infra:destroy しても DB 本体は削除されない（誤削除防止）
});

// アプリ/マイグレーション用ロール。TTL なし（無期限）。
const dbRole = await Role("db-role", {
  database,
  inheritedRoles: ["postgres"],
});

// ---- Hyperdrive --------------------------------------------------------
// ADR-002: origin は PlanetScale の直接続エンドポイント（port 5432）。
// pooled 接続（port 6432 / PgBouncer）を使うと Hyperdrive と pooler の二段構成になり、
// Supabase 時代に踏んだものと同種の接続調整エラーの温床になるため使わない。
const hyperdrive = await Hyperdrive("hyperdrive", {
  name: `${appName}-${stage}`,
  adopt: true,
  origin: {
    host: dbRole.host,
    port: 5432,
    database: dbRole.databaseName,
    user: dbRole.username,
    password: dbRole.password,
  },
});

// ---- Worker ------------------------------------------------------------
// vite build（@cloudflare/vite-plugin）の成果物をそのままデプロイする。
// noBundle: true — dist/server/ 以下の .js チャンクは既に CF Workers 向けにバンドル済み。
// SKIP_WORKER=1（CI の provision フェーズ）では DB/Hyperdrive までで止める。
if (process.env.SKIP_WORKER !== "1") {
  const entrypoint = "apps/client/dist/server/index.js";
  if (!existsSync(entrypoint)) {
    throw new Error(
      `${entrypoint} がありません。先に \`cd apps/client && bun run build\` を実行してください`,
    );
  }

  // Better Auth / CORS はデプロイ後の公開 URL を必要とする。
  // APP_ORIGIN で明示指定するか、WORKERS_SUBDOMAIN（CF アカウントの workers.dev サブドメイン）から組み立てる。
  // ?? ではなく || : CI では未設定の GitHub Variable が「空文字列」として渡ってくるため、
  // 空でも WORKERS_SUBDOMAIN へフォールバックさせる。
  const appOrigin =
    process.env.APP_ORIGIN ||
    (process.env.WORKERS_SUBDOMAIN
      ? `https://${workerName}.${process.env.WORKERS_SUBDOMAIN}.workers.dev`
      : undefined);
  if (!appOrigin) {
    throw new Error(
      "APP_ORIGIN または WORKERS_SUBDOMAIN を設定してください（BETTER_AUTH_URL / CORS_ORIGIN に使用）",
    );
  }

  const worker = await Worker("client", {
    name: workerName,
    entrypoint,
    noBundle: true,
    compatibilityDate: "2026-06-01", // wrangler.jsonc の compatibility_date と揃える
    compatibilityFlags: ["nodejs_compat"],
    adopt: true,
    url: true,
    observability: { enabled: true },
    bindings: {
      ASSETS: await Assets({ path: "apps/client/dist/client" }),
      HYPERDRIVE: hyperdrive,
      NODE_ENV: "production",
      CORS_ORIGIN: appOrigin,
      BETTER_AUTH_URL: appOrigin,
      BETTER_AUTH_SECRET: alchemy.secret(requireEnv("BETTER_AUTH_SECRET")),
      GOOGLE_CLIENT_ID: alchemy.secret(requireEnv("GOOGLE_CLIENT_ID")),
      GOOGLE_CLIENT_SECRET: alchemy.secret(requireEnv("GOOGLE_CLIENT_SECRET")),
    },
  });

  console.info(`[alchemy] worker=${workerName} url=${worker.url ?? "(workers.dev URL 無効)"}`);
}

console.info(`[alchemy] stage=${stage} hyperdrive=${hyperdrive.hyperdriveId}`);
console.info(`[alchemy] planetscale db=${database.name} role=${dbRole.username}`);

// CI の migrate フェーズへ DATABASE_URL を渡す。値はログに出さずマスク登録のみ行う
// （::add-mask:: 以降、GitHub Actions のログでこの値は *** に置換される）。
if (process.env.GITHUB_ENV) {
  const databaseUrl = dbRole.connectionUrl.unencrypted;
  console.info(`::add-mask::${databaseUrl}`);
  appendFileSync(process.env.GITHUB_ENV, `DATABASE_URL=${databaseUrl}\n`);
}

// ローカルでのマイグレーション/デバッグ用の取り出し口。
// シークレットのログ漏えい防止のため、明示的に要求されたときだけ表示する。
// CI では絶対に有効化しないこと。
if (process.env.SHOW_DATABASE_URL === "1" && !process.env.CI) {
  console.info(`[alchemy] DATABASE_URL=${dbRole.connectionUrl.unencrypted}`);
}

await app.finalize();
