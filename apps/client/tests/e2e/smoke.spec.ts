import { expect, test } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("トップページが正常に読み込まれる", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("未認証で / にアクセスすると /signin へリダイレクトされ、サインインボタンが表示される", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForURL("**/signin**");
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  });

  test("存在しないページで404が返る", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
  });
});
