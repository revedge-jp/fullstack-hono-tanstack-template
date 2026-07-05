/**
 * Alchemy (Infrastructure as TypeScript) — Cloudflare リソース定義
 *
 * 既存の wrangler.jsonc / deploy.yml を置き換えない検証用（PoC）。
 * Hyperdrive の作成と Worker のデプロイを TypeScript 一枚で管理する。
 *
 * 使い方: docs/dev/alchemy-iac.md を参照
 *   bun run infra:deploy:staging   # ビルド + staging デプロイ
 *   bun run infra:destroy:staging  # staging リソース削除
 */
import { existsSync } from "node:fs";

import alchemy from "alchemy";
import { Assets, Hyperdrive, Worker } from "alchemy/cloudflare";

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

const app = await alchemy(appName);

const stage = app.stage;
if (stage !== "staging" && stage !== "production") {
  throw new Error(`stage は staging | production のみ対応です（--stage で指定、現在: ${stage}）`);
}

// wrangler.jsonc の env 命名と揃える: staging は -staging サフィックス、production は素の名前
const workerName = stage === "production" ? appName : `${appName}-${stage}`;

// ---- Hyperdrive --------------------------------------------------------
// ADR-002: Supabase は Session Mode (port 5432) に接続すること。
// Transaction Mode (6543) は Hyperdrive ノード間の調整エラーを起こす。
const origin = new URL(requireEnv("HYPERDRIVE_ORIGIN_URL"));
const originPort = origin.port === "" ? 5432 : Number(origin.port);
if (originPort !== 5432) {
  throw new Error(
    `HYPERDRIVE_ORIGIN_URL の port が ${originPort} です。` +
      "ADR-002 により Session Mode (port 5432) を使用してください（Transaction Mode 6543 は不可）",
  );
}

const hyperdrive = await Hyperdrive("hyperdrive", {
  name: `${appName}-${stage}`,
  adopt: true,
  origin: {
    host: origin.hostname,
    port: originPort,
    database: decodeURIComponent(origin.pathname.slice(1)) || "postgres",
    user: decodeURIComponent(origin.username),
    password: alchemy.secret(decodeURIComponent(origin.password)),
  },
});

// ---- Worker ------------------------------------------------------------
// vite build（@cloudflare/vite-plugin）の成果物をそのままデプロイする。
// noBundle: true — dist/server/ 以下の .js チャンクは既に CF Workers 向けにバンドル済み。
const entrypoint = "apps/client/dist/server/index.js";
if (!existsSync(entrypoint)) {
  throw new Error(
    `${entrypoint} がありません。先に \`cd apps/client && bun run build\` を実行してください`,
  );
}

// Better Auth / CORS はデプロイ後の公開 URL を必要とする。
// APP_ORIGIN で明示指定するか、WORKERS_SUBDOMAIN（CF アカウントの workers.dev サブドメイン）から組み立てる。
const appOrigin =
  process.env.APP_ORIGIN ??
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
  compatibilityDate: "2025-01-01",
  compatibilityFlags: ["nodejs_compat_v2"],
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

console.info(`[alchemy] stage=${stage} worker=${workerName}`);
console.info(`[alchemy] url=${worker.url ?? "(workers.dev URL 無効)"}`);
console.info(`[alchemy] hyperdrive=${hyperdrive.hyperdriveId}`);

await app.finalize();
