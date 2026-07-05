import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
// prod-shape モード: dev サーバーではなく、ビルド成果物（SSR + API が 1 Worker に同居）を
// workerd で起動して E2E を流す。dev（Bun / vite dev）と本番（workerd）のランタイム乖離 —
// バンドル・per-request 生成・ctx.waitUntil・AsyncLocalStorage 等 — をデプロイ前に検証する。
// 実行: E2E_PROD_SHAPE=1 bunx playwright test（または scripts/test/test-e2e.sh --prod-shape）
const isProdShape = !!process.env.E2E_PROD_SHAPE;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 1,
  reporter: "html",
  use: {
    // E2E は専用ポート（dev: 3200 / prod-shape: 3100）を使い、開発サーバー（3000）とは共存させる。
    // 既存サーバーの再利用はしない（reuseExistingServer: false）— 別の env/DB を向いた
    // 開発サーバーや前回実行の残骸を拾うと、テストが「静かに間違った対象」を検証してしまうため。
    // 専用ポートに残った孤児プロセスは scripts/test/test-e2e.sh が起動前に掃除する。
    baseURL: isProdShape ? "http://localhost:3100" : "http://localhost:3200",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      fullyParallel: true,
    },
    {
      name: "scenario",
      testMatch: /tasks\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: isProdShape
    ? [
        {
          // vite preview は @cloudflare/vite-plugin 経由でビルド成果物を workerd で起動し、
          // 環境変数は wrangler.jsonc の vars と .dev.vars から読む（dev と同じ）。
          command: "bun run build && bunx vite preview --port 3100 --strictPort",
          url: "http://localhost:3100/api/health",
          reuseExistingServer: false,
          timeout: 240_000,
        },
      ]
    : [
        // API は client Worker（server.ts が /api/* を in-process の Hono へディスパッチ）に
        // 同居しているため、vite dev サーバー1本で SSR も API も賄える。
        {
          command: "bunx vite --port 3200 --strictPort",
          url: "http://localhost:3200",
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
