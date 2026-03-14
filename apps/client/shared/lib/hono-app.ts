import { createApp } from "api-service";

type CFBindings = Record<string, string | { connectionString: string } | undefined>;

function buildEnv(cfEnv: CFBindings): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  let hyperdriveUrl: string | undefined;
  for (const [key, val] of Object.entries(cfEnv)) {
    if (typeof val === "string") {
      env[key] = val;
    } else if (val !== null && typeof val === "object" && "connectionString" in val) {
      hyperdriveUrl = val.connectionString;
    }
  }
  // Hyperdrive が利用可能な場合は優先し、なければ DATABASE_URL シークレットにフォールバックする。
  // Hyperdrive はオリジン DB へのコネクションプーリングと TLS 終端を担う。
  if (hyperdriveUrl) {
    env.DATABASE_URL = hyperdriveUrl;
  }
  return env;
}

// Cloudflare Hyperdrive のドキュメントに従い、postgres.js クライアントはリクエストごとに
// 生成する（モジュールシングルトンにしない）ことで、ctx.waitUntil(end()) が
// 各レスポンス後にイベントループを適切に解放できる。
export function initHonoApp(cfEnv: CFBindings) {
  const env = buildEnv(cfEnv);
  return createApp(env);
}

// ローカル開発用（TanStack Start 開発サーバー、createServerFn のインプロセス呼び出し）。
// process.env（.env の DATABASE_URL）を使用。CF Workers 本番環境では使用しない。
let _devInstance: ReturnType<typeof createApp> | undefined;
export function getHonoApp() {
  if (!_devInstance) {
    _devInstance = createApp();
  }
  return _devInstance.app;
}
