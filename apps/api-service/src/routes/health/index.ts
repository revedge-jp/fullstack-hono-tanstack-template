import { createApp } from "@app/factory";
import { type Database, sql } from "@repo/db";

// DB がハングしても health 自体は必ず短時間で応答する（readiness チェックが
// 無限待ちになると監視側のタイムアウトに依存してしまうため、自前で上限を持つ）。
const DB_CHECK_TIMEOUT_MS = 3000;

export function createHealthRouter(deps: { db: Database }) {
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
          return c.json({ status: "unavailable" }, 503);
        }
        return c.json({ status: "ok" });
      } catch {
        return c.json({ status: "unavailable" }, 503);
      } finally {
        clearTimeout(timer);
      }
    })
    .get("/live", (c) => c.json({ status: "ok" }));
}
