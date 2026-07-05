import { createApp } from "@app/factory";
import { type SQL, sql } from "@repo/db";

// health は readiness の SELECT 1 しか投げないため、フル ORM ではなく
// この最小インターフェースだけに依存する（テストで差し替えやすくする）。
export type HealthDb = { execute: (query: SQL) => Promise<unknown> };

export type HealthInfo = {
  // デプロイ時に注入されるビルド識別子（未注入なら "dev"）。監視・障害切り分け用。
  version: string;
  commit: string;
};

// DB がハングしても health 自体は必ず短時間で応答する（readiness チェックが
// 無限待ちになると監視側のタイムアウトに依存してしまうため、自前で上限を持つ）。
const DB_CHECK_TIMEOUT_MS = 3000;

export function createHealthRouter(deps: { db: HealthDb; info: HealthInfo }) {
  return createApp()
    .get("/", async (c) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), DB_CHECK_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([
          deps.db.execute(sql`SELECT 1`).then(() => "ok" as const),
          timeout,
        ]);
        if (result === "timeout") {
          return c.json({ status: "unavailable", ...deps.info }, 503);
        }
        return c.json({ status: "ok", ...deps.info });
      } catch {
        return c.json({ status: "unavailable", ...deps.info }, 503);
      } finally {
        clearTimeout(timer);
      }
    })
    .get("/live", (c) => c.json({ status: "ok", ...deps.info }));
}
