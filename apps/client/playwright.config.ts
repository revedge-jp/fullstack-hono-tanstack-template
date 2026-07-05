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
    // prod-shape は 3100 を使う（開発サーバーが 3000 を掴んでいても共存できるように）
    baseURL: isProdShape ? "http://localhost:3100" : "http://localhost:3000",
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
        {
          command: "bun run --hot src/index.ts",
          cwd: "../../apps/api-service",
          url: "http://localhost:8080/api/health",
          reuseExistingServer: !isCI,
          env: {
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              "postgresql://postgres:postgres@localhost:5433/app_db",
            NODE_ENV: "test",
            API_PORT: "8080",
            LOG_PRETTY: "false",
            BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "dummy-secret-for-e2e",
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "dummy-client-id",
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "dummy-client-secret",
          },
          timeout: 30_000,
        },
        {
          command: "bunx vite --port 3000",
          url: "http://localhost:3000",
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
      ],
});
