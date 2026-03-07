import { createApp } from "@app/factory";
import type { PrismaClient } from "@repo/db";

export function createHealthRouter(deps: { prisma: PrismaClient }) {
  return createApp()
    .get("/", async (c) => {
      try {
        await deps.prisma.$queryRaw`SELECT 1`;
        return c.json({ status: "ok" });
      } catch {
        return c.json({ status: "unavailable" }, 503);
      }
    })
    .get("/live", (c) => c.json({ status: "ok" }));
}
