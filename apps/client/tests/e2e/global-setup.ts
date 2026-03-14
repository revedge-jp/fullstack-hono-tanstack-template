import { execSync } from "node:child_process";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/app_db";

export default function globalSetup() {
  if (process.env.CI) {
    console.log("[global-setup] CI detected — skipping migrate (already done in workflow).");
    return;
  }
  console.log("[global-setup] Running drizzle-kit migrate...");
  execSync("bunx drizzle-kit migrate", {
    cwd: "../../packages/database",
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  console.log("[global-setup] Migration complete.");
}
