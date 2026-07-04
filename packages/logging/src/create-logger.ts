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
// そのため「development か」ではなく「Workers ランタイムか」で transport の可否を判定する。
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

// pino の Node ビルドは `browser` オプションを無視し、stream 引数を渡さない限り常に
// SafeSonicBoom（内部で WeakRef 等の Node 専用APIを使う）を構築しようとする。Workers
// ランタイムにはそれらが無いため、stream を明示的に渡してデフォルトの destination
// 構築自体を完全にスキップさせる。console.log のみに依存するため Bun/Node/Workers のどこでも動く。
const consoleStream = {
  write(msg: string) {
    try {
      console.log(JSON.parse(msg));
    } catch {
      console.log(msg);
    }
  },
};

export function createLogger(options: CreateLoggerOptions) {
  const { service, version, level, environment } = options;
  const base = { service, ...(version ? { version } : {}) };

  if (environment === "test") {
    return pino({ level: "silent" }, consoleStream);
  }

  if (environment === "development" && !isCloudflareWorkersRuntime()) {
    // ローカル開発（api-service を Bun で直接起動する場合のみ）: pino-pretty で見やすく整形する。
    // pino-pretty（transport）は worker_threads を使うため Workers ランタイム（emulation 含む）では動かない。
    return pino({
      level: level ?? "debug",
      base,
      transport: { target: "pino-pretty" },
    });
  }

  // production、および client 経由のローカル開発（@cloudflare/vite-plugin の workerd emulation 上で動く）。
  return pino({ level: level ?? "info", base }, consoleStream);
}
