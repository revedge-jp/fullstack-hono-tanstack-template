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
      name: "scenario",
      testMatch: /tasks\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
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
