import { expect, test } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("トップページが正常に読み込まれる", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("Demo カードが表示され API+DB が正常に動作している", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Demo")).toBeVisible();
    await expect(page.locator("text=Failed to load users.")).not.toBeVisible();
  });

  test("存在しないページで404が返る", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
  });
});
