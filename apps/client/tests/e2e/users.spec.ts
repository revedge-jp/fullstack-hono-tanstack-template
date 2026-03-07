import { expect, test } from "./fixtures";

const submitButton = 'button[type="submit"]';

test.describe("Users full-stack flow", () => {
  test("ユーザーを作成すると一覧に表示される", async ({ page }) => {
    await page.goto("/");

    await page.fill('input[name="email"]', "alice@example.com");
    await page.fill('input[name="name"]', "Alice");
    await page.click(submitButton);
    await expect(page.locator(submitButton)).toHaveText("Create");

    await expect(page.locator("text=alice@example.com")).toBeVisible();
    await expect(page.getByText("— Alice")).toBeVisible();
  });

  test("複数ユーザーを作成できる", async ({ page }) => {
    await page.goto("/");

    // 1人目
    await page.fill('input[name="email"]', "bob@example.com");
    await page.fill('input[name="name"]', "Bob");
    await page.click(submitButton);
    await expect(page.locator(submitButton)).toHaveText("Create");
    await expect(page.locator("text=bob@example.com")).toBeVisible();

    // 2人目
    await page.fill('input[name="email"]', "carol@example.com");
    await page.fill('input[name="name"]', "Carol");
    await page.click(submitButton);
    await expect(page.locator(submitButton)).toHaveText("Create");
    await expect(page.locator("text=carol@example.com")).toBeVisible();

    // 両方表示されている
    await expect(page.locator("text=bob@example.com")).toBeVisible();
    await expect(page.locator("text=carol@example.com")).toBeVisible();
  });

  test("name なしでユーザーを作成できる", async ({ page }) => {
    await page.goto("/");

    await page.fill('input[name="email"]', "noname@example.com");
    await page.click(submitButton);
    await expect(page.locator(submitButton)).toHaveText("Create");

    await expect(page.locator("text=noname@example.com")).toBeVisible();
  });

  test("ユーザー名を編集できる", async ({ page }) => {
    await page.goto("/");

    // ユーザー作成
    await page.fill('input[name="email"]', "edit@example.com");
    await page.fill('input[name="name"]', "Before");
    await page.click(submitButton);
    await expect(page.locator(submitButton)).toHaveText("Create");
    await expect(page.getByText("— Before")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Edit をクリックして編集モードに
    const listItem = page.getByRole("listitem").filter({ hasText: "edit@example.com" });
    await listItem.getByRole("button", { name: "Edit" }).click();
    await expect(listItem.locator('input[name="name"]')).toBeVisible();

    // 名前を変更して保存
    await listItem.locator('input[name="name"]').fill("After");
    await listItem.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("— After")).toBeVisible();
  });
});
