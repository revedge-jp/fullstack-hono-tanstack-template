import { createApp } from "./app";
import { loadConfig } from "./config";

type FetchHandler = (req: Request) => Response | Promise<Response>;
type BunServer = { port: number };
type BunGlobal = {
  serve: (options: { fetch: FetchHandler; port: number }) => BunServer;
};
declare const Bun: BunGlobal;

const { port, nodeEnv } = loadConfig();
const { app } = createApp();

const server = Bun.serve({ fetch: app.fetch, port });
console.log(`Server is running on http://localhost:${server.port} (env: ${nodeEnv})`);
