import { test as base } from "@playwright/test";
import { resetDatabase } from "./helpers/reset-db";

export const test = base.extend<object>({
  page: async ({ page }, use) => {
    await resetDatabase();
    await use(page);
  },
});

export { expect } from "@playwright/test";
