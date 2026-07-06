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
import { Assets, CustomDomain, Hyperdrive, LogPushJob, Ruleset, Worker } from "alchemy/cloudflare";
import { Branch, Database, Role } from "alchemy/planetscale";
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
// pr-<番号> は PR プレビュー環境（preview.yml が管理。DB は staging DB のブランチ）
const isPreview = /^pr-\d+$/.test(stage);
if (stage !== "staging" && stage !== "production" && !isPreview) {
  throw new Error(
    `stage は staging | production | pr-<番号> のみ対応です（--stage で指定、現在: ${stage}）`,
  );
}

// wrangler.jsonc の env 命名と揃える: staging は -staging サフィックス、production は素の名前
const workerName = stage === "production" ? appName : `${appName}-${stage}`;

// ---- オプション機能（カスタムドメイン運用時のみ有効化） -------------------
// いずれも preview では無視する（preview の URL は常に workers.dev、リソースは使い捨て）。
//
// CUSTOM_DOMAIN: Worker に割り当てるホスト名（例: app.example.com）。zone が同じ
// CF アカウントにあれば zone ID はホスト名から自動解決され、DNS レコードの作成・
// TLS 証明書の発行まで Cloudflare 側で自動化される。API トークンには Workers 権限に
// 加えて対象 zone の Zone:Read + DNS:Edit が必要（docs/deploy/cloudflare-workers.md）。
const customDomain = (!isPreview && process.env.CUSTOM_DOMAIN) || undefined;
if (customDomain && /^https?:\/\//.test(customDomain)) {
  throw new Error(
    `CUSTOM_DOMAIN はホスト名のみで指定してください（例: app.example.com、現在: ${customDomain}）`,
  );
}

// EDGE_RATE_LIMIT_RPM: エッジ（WAF）での /api/* レート制限。IP ごとの分間リクエスト数。
// zone 必須のため CUSTOM_DOMAIN とセットでのみ有効。
//
// 【重要】Ruleset リソースは対象 zone の http_ratelimit フェーズの entrypoint を
// 「丸ごと」管理する（既存ルールは上書き、destroy でフェーズ全体が空になる）。
//   - 同じ zone を他のアプリ・手動ルールと共有している場合は有効化しないこと
//   - staging と production が同一 zone を共有する場合、有効化はどちらか一方のみ
//     （両方で有効化すると後からデプロイした stage が相手のルールを消す）
const edgeRateLimitRpmRaw = (!isPreview && process.env.EDGE_RATE_LIMIT_RPM) || undefined;
const edgeRateLimitRpm = edgeRateLimitRpmRaw ? Number(edgeRateLimitRpmRaw) : undefined;
if (
  edgeRateLimitRpm !== undefined &&
  (!Number.isInteger(edgeRateLimitRpm) || edgeRateLimitRpm < 6)
) {
  throw new Error(
    `EDGE_RATE_LIMIT_RPM は 6 以上の整数で指定してください（現在: ${edgeRateLimitRpmRaw}）`,
  );
}
if (edgeRateLimitRpm !== undefined && !customDomain) {
  throw new Error(
    "EDGE_RATE_LIMIT_RPM には CUSTOM_DOMAIN が必要です（zone 単位の WAF ルールのため）",
  );
}

// LOGPUSH_DESTINATION: Worker の trace ログ（console.log / 例外）を外部へ転送する
// Logpush の宛先 URI（例: R2 なら r2://bucket/path?account-id=...&access-key-id=...&
// secret-access-key=...）。Workers Paid プランが必要。値に資格情報を含むため secret 扱い。
const logpushDestination = (!isPreview && process.env.LOGPUSH_DESTINATION) || undefined;

// ---- PlanetScale (DB + Role) -------------------------------------------
// 認証はサービストークン（PLANETSCALE_SERVICE_TOKEN_ID / PLANETSCALE_SERVICE_TOKEN）。
// プロバイダは環境変数を暗黙参照するが、エラーを早期化するためここで検証する。
requireEnv("PLANETSCALE_SERVICE_TOKEN_ID");
requireEnv("PLANETSCALE_SERVICE_TOKEN");
const planetscaleOrg = requireEnv("PLANETSCALE_ORGANIZATION");

let dbRole: Role;
let dbDisplayName: string;
if (isPreview) {
  // PR プレビュー: staging DB のブランチ（PS-DEV、存在時間分だけの課金）を使い捨て DB として使う。
  // スキーマ・データは複製されないため、preview.yml が migration を頭から適用する。
  const branch = await Branch("db-branch", {
    name: stage, // 例: pr-123
    database: `${appName}-staging`, // staging DB が親（先に staging がデプロイされている必要がある）
    organization: planetscaleOrg,
    isProduction: false,
    adopt: true,
    // 必ず明示する: JSDoc は「デフォルト true」と言うが実装は `props.delete ?? false`
    // （alchemy 0.93 のドキュメント齟齬）。明示しないと destroy で state から外れるだけで
    // ブランチ実体が残り、PS-DEV の課金が続く
    delete: true,
  });
  dbRole = await Role("db-role", {
    database: `${appName}-staging`,
    organization: planetscaleOrg,
    branch,
    inheritedRoles: ["postgres"],
  });
  dbDisplayName = `${appName}-staging#${stage}`;
} else {
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
  dbRole = await Role("db-role", {
    database,
    inheritedRoles: ["postgres"],
  });
  dbDisplayName = database.name;
}

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
  // CUSTOM_DOMAIN（Alchemy がドメイン割り当てまで行う）→ APP_ORIGIN（手動割り当てした URL の
  // 明示指定・後方互換）→ WORKERS_SUBDOMAIN（workers.dev URL の組み立て）の順で解決する。
  // ?? ではなく || : CI では未設定の GitHub Variable が「空文字列」として渡ってくるため、
  // 空でも次の候補へフォールバックさせる。
  // preview では CUSTOM_DOMAIN / APP_ORIGIN を無視する（staging のカスタムドメインを指すため。
  // preview の URL は常に workers.dev — WORKERS_SUBDOMAIN が必須）。
  const appOrigin =
    (customDomain && `https://${customDomain}`) ||
    (!isPreview && process.env.APP_ORIGIN) ||
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
    // Logpush 転送は Worker 側のフラグと LogPushJob の両方が必要（下のブロック参照）
    logpush: logpushDestination !== undefined,
    bindings: {
      ASSETS: await Assets({ path: "apps/client/dist/client" }),
      HYPERDRIVE: hyperdrive,
      NODE_ENV: "production",
      CORS_ORIGIN: appOrigin,
      BETTER_AUTH_URL: appOrigin,
      // /api/health が返すビルド情報。CI（deploy.yml / preview.yml）が環境変数で渡す。
      APP_VERSION: process.env.APP_VERSION || "dev",
      GIT_SHA: process.env.GIT_SHA || "dev",
      BETTER_AUTH_SECRET: alchemy.secret(requireEnv("BETTER_AUTH_SECRET")),
      GOOGLE_CLIENT_ID: alchemy.secret(requireEnv("GOOGLE_CLIENT_ID")),
      GOOGLE_CLIENT_SECRET: alchemy.secret(requireEnv("GOOGLE_CLIENT_SECRET")),
    },
  });

  console.info(`[alchemy] worker=${workerName} url=${worker.url ?? "(workers.dev URL 無効)"}`);

  // ---- カスタムドメイン（opt-in） ----------------------------------------
  // DNS レコード・TLS 証明書は Cloudflare が自動管理。appOrigin はこのドメインから
  // 導出済みなので、Better Auth / CORS の URL も自動で一致する。
  if (customDomain) {
    await CustomDomain("custom-domain", {
      name: customDomain,
      workerName,
      adopt: true,
    });
    console.info(`[alchemy] custom domain=${customDomain} -> ${workerName}`);
  }

  // ---- エッジレート制限（opt-in・zone の http_ratelimit フェーズを専有） ----
  // アプリ内の rate-limit ミドルウェア（isolate ローカル）より手前、Cloudflare エッジで
  // IP ごとに /api/* を制限する。無料プランの制約（period/mitigation_timeout = 10 秒固定）に
  // 合わせて RPM を 10 秒あたりに換算する。ホスト名でスコープしているが、entrypoint の
  // 「専有」は zone 単位なので、上の EDGE_RATE_LIMIT_RPM の注意書きを必ず読むこと。
  if (customDomain && edgeRateLimitRpm !== undefined) {
    const requestsPer10s = Math.max(1, Math.round(edgeRateLimitRpm / 6));
    await Ruleset("edge-rate-limit", {
      zone: customDomain,
      phase: "http_ratelimit",
      description: `${workerName}: /api/* rate limit (managed by alchemy)`,
      rules: [
        {
          description: `${workerName}: limit /api/* to ${edgeRateLimitRpm} req/min per IP`,
          expression: `(http.host eq "${customDomain}" and starts_with(http.request.uri.path, "/api/"))`,
          action: "block",
          ratelimit: {
            characteristics: ["cf.colo.id", "ip.src"],
            period: 10,
            requests_per_period: requestsPer10s,
            mitigation_timeout: 10,
          },
        },
      ],
    });
    console.info(
      `[alchemy] edge rate limit=${edgeRateLimitRpm} rpm (${requestsPer10s}/10s) on ${customDomain}/api/*`,
    );
  }

  // ---- Logpush（opt-in・Workers Paid） -----------------------------------
  // Worker の logpush フラグ（上の Worker 定義）とセット。dataset は Worker の
  // console.log / 例外 / メタデータを含む workers_trace_events（アカウントレベル）。
  if (logpushDestination) {
    await LogPushJob("worker-logpush", {
      name: `${workerName}-trace`,
      dataset: "workers_trace_events",
      destination: alchemy.secret(logpushDestination),
      enabled: true,
    });
    console.info(`[alchemy] logpush job=${workerName}-trace (workers_trace_events)`);
  }
}

console.info(`[alchemy] stage=${stage} hyperdrive=${hyperdrive.hyperdriveId}`);
console.info(`[alchemy] planetscale db=${dbDisplayName} role=${dbRole.username}`);

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
