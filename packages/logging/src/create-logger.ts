/** biome-ignore-all lint/suspicious/noConsole: console is the log sink itself (Workers-safe stream) */
import pino from "pino";

export type CreateLoggerOptions = {
  service: string;
  version?: string;
  level?: string;
  environment?: string;
};

// Cloudflare Workers（本番・および wrangler/vite-plugin のローカル emulation 両方）の標準的な検出方法。
// client アプリは開発時でも @cloudflare/vite-plugin 経由で workerd 上で動くため、
// NODE_ENV=development であっても worker_threads は使えない。
// そのため「development か」ではなく「Workers ランタイムか」で出力先を判定する。
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

// pino の Node ビルドは `browser` オプションを無視し、stream 引数を渡さない限り常に
// SafeSonicBoom（内部で WeakRef 等の Node 専用APIを使う）を構築しようとする。Workers
// ランタイムにはそれらが無いため、stream を明示的に渡してデフォルトの destination
// 構築自体を完全にスキップさせる。console 呼び出しのみに依存する。
// レベルに応じて console.error / console.warn を使い分けることで、
// Cloudflare ダッシュボード側のログ重要度表示を正しくする。
const WARN_LEVEL = 40;
const ERROR_LEVEL = 50;
const workersConsoleStream = {
  write(msg: string) {
    try {
      const obj = JSON.parse(msg);
      const level = typeof obj.level === "number" ? obj.level : 0;
      if (level >= ERROR_LEVEL) {
        console.error(obj);
      } else if (level >= WARN_LEVEL) {
        console.warn(obj);
      } else {
        console.log(obj);
      }
    } catch {
      console.log(msg);
    }
  },
};

export function createLogger(options: CreateLoggerOptions) {
  const { service, version, level, environment } = options;
  const base = { service, ...(version ? { version } : {}) };

  if (environment === "test") {
    return pino({ level: "silent" }, workersConsoleStream);
  }

  // Workers ランタイム（本番の CF Workers・および client 開発時の workerd emulation）:
  // worker_threads / sonic-boom が使えないため console ベースの stream に固定する。
  if (isCloudflareWorkersRuntime()) {
    return pino(
      { level: level ?? (environment === "development" ? "debug" : "info"), base },
      workersConsoleStream,
    );
  }

  if (environment === "development") {
    // ローカル開発（api-service を Bun で直接起動する場合）: pino-pretty で見やすく整形する。
    // pino-pretty（transport）は worker_threads を使うため Workers ランタイムでは使えない。
    return pino({
      level: level ?? "debug",
      base,
      transport: { target: "pino-pretty" },
    });
  }

  // Bun / Node の本番実行（コンテナ等）: pino デフォルトの stdout 出力（NDJSON）。
  // console.log(object) は util.inspect 形式になり構造化ログでなくなるため、
  // Workers 以外の本番で console ベースの stream を使ってはいけない。
  return pino({ level: level ?? "info", base });
}
