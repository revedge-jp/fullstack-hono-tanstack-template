import { createApp } from "api-service";

type CFBindings = Record<string, string | { connectionString: string } | undefined>;

function buildEnv(cfEnv: CFBindings): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  let hyperdriveUrl: string | undefined;
  for (const [key, val] of Object.entries(cfEnv)) {
    if (typeof val === "string") {
      env[key] = val;
    } else if (
      val !== null &&
      typeof val === "object" &&
      "connectionString" in val &&
      // ASSETS 等の Fetcher/RPC プロキシは任意のプロパティ名の `in` に true を返すため、
      // 実際に string であることまで確認しないと Hyperdrive の URL がプロキシの
      // スタブ値で上書きされる（named assets binding を持つ Alchemy デプロイで顕在化）
      typeof val.connectionString === "string"
    ) {
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
