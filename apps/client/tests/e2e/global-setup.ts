import { execSync } from "node:child_process";

import { readDevVars } from "./helpers/dev-vars";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/app_db";

export default function globalSetup() {
  // アプリは .dev.vars の DATABASE_URL を使い、準備（migrate）と後片付け（TRUNCATE）は TEST_DATABASE_URL に
  // 当たる。食い違うと、アプリとサインイン用のセッションは開発 DB に、TRUNCATE はテスト DB に向かう。
  // bunx playwright test を直接実行すると .dev.vars が .env（開発 DB）を指したままなので、ここで止める
  const appDatabaseUrl = readDevVars().DATABASE_URL;
  if (appDatabaseUrl !== TEST_DATABASE_URL) {
    throw new Error(
      [
        "E2E のアプリ（apps/client/.dev.vars の DATABASE_URL）とテストの準備・後片付け（TEST_DATABASE_URL）が別の DB を指しています。",
        `  .dev.vars: ${appDatabaseUrl === undefined ? "（DATABASE_URL が無い）" : redactPassword(appDatabaseUrl)}`,
        `  TEST_DATABASE_URL: ${redactPassword(TEST_DATABASE_URL)}`,
        "bunx playwright test を直接実行せず、bun run test:e2e で実行してください（.dev.vars を一時的にテスト DB へ向けます）。",
      ].join("\n"),
    );
  }
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

function redactPassword(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");
}
