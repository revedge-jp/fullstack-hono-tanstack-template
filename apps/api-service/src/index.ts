import { createApp } from "./app";
import { loadConfig } from "./config";

type FetchHandler = (req: Request) => Response | Promise<Response>;
type BunServer = {
  port: number;
  // 新規接続を止め、既存リクエストの完了を待つ（closeActiveConnections で強制切断）。
  stop: (closeActiveConnections?: boolean) => Promise<void>;
};
type BunGlobal = {
  serve: (options: { fetch: FetchHandler; port: number }) => BunServer;
};
declare const Bun: BunGlobal;

// 猶予時間を過ぎても停止しきらない場合に、残った接続を強制切断して確実に終了させる。
const SHUTDOWN_TIMEOUT_MS = 10_000;

const { port, nodeEnv } = loadConfig();
const { app, end } = createApp();

const server = Bun.serve({ fetch: app.fetch, port });
console.log(`Server is running on http://localhost:${server.port} (env: ${nodeEnv})`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);

  const hardTimeout = setTimeout(() => {
    console.error(`Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // タイマー自体がプロセス終了を妨げないようにする。
  hardTimeout.unref?.();

  try {
    // 新規接続を止めて in-flight を捌き切ってから、DB プールを drain する。
    await server.stop();
    await end();
    clearTimeout(hardTimeout);
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown", err);
    clearTimeout(hardTimeout);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
