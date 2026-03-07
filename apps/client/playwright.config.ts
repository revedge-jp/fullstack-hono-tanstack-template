import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
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
      name: "users",
      testMatch: /users\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      fullyParallel: false,
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: [
    {
      command: "bun run --hot src/index.ts",
      cwd: "../../apps/api-service",
      url: "http://localhost:8080/api/health",
      reuseExistingServer: !isCI,
      env: {
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/app_db",
        NODE_ENV: "test",
        API_PORT: "8080",
        LOG_PRETTY: "false",
      },
      timeout: 30_000,
    },
    {
      command: isCI ? "node .next/standalone/apps/client/server.js" : "bunx next dev",
      url: "http://localhost:3000",
      reuseExistingServer: !isCI,
      env: {
        API_BASE_URL: "http://localhost:8080",
        ...(isCI ? { PORT: "3000", HOSTNAME: "0.0.0.0" } : {}),
      },
      timeout: isCI ? 10_000 : 30_000,
    },
  ],
});
