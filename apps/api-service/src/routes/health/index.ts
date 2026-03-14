import { createApp } from "@app/factory";
import { type Database, sql } from "@repo/db";

export function createHealthRouter(deps: { db: Database }) {
  return createApp()
    .get("/", async (c) => {
      try {
        await deps.db.execute(sql`SELECT 1`);
        return c.json({ status: "ok" });
      } catch {
        return c.json({ status: "unavailable" }, 503);
      }
    })
    .get("/live", (c) => c.json({ status: "ok" }));
}
