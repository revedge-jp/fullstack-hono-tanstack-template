import { expect, test } from "@playwright/test";

import { type SeededUser, seedSignedInUser } from "./helpers/auth";

// tasks 正典 feature の一気通貫シナリオ:
// ログイン済み状態（DB シード + 署名済み cookie）で 作成 → 進行 → 完了 → 削除 を辿る。
// UI・ServerFn・Hono ルーター・ユースケース・Drizzle・実DB のすべてを貫通する。
test.describe("tasks シナリオ", () => {
  let user: SeededUser;

  test.beforeAll(async () => {
    user = await seedSignedInUser("tasks-scenario");
  });

  // auth pool のクローズは global-teardown に集約（spec ごとの閉じ忘れを防ぐ）
  test.afterAll(async () => {
    await user.cleanup();
  });

  test("タスクを作成 → 進行 → 完了 → 削除できる", async ({ context, page }) => {
    await user.signIn(context);

    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "タスク" })).toBeVisible();

    // 作成。
    // SSR 直後は React の hydration が終わっておらず、fill しても onChange が発火しない。
    // さらに React は「DOM 値が変化しない input イベント」を無視する（value tracker）ため、
    // hydration 前の fill で DOM に値が残ると、hydration 後に同じ値を fill し直しても
    // onChange が発火しない。リトライごとに一度クリアしてから入力することで、
    // hydration 完了後のリトライで必ず値の変化（"" → title）が起きるようにする。
    const title = `E2E タスク ${Date.now()}`;
    const addButton = page.getByRole("button", { name: "追加" });
    const titleInput = page.getByLabel("タスクのタイトル");
    await expect(async () => {
      await titleInput.fill("");
      await titleInput.fill(title);
      await expect(addButton).toBeEnabled({ timeout: 1000 });
    }).toPass();
    await addButton.click();
    const item = page.locator("li", { hasText: title });
    await expect(item).toBeVisible();
    await expect(item.getByText("未着手")).toBeVisible();

    // 進行: 未着手 → 進行中
    await item.getByRole("button", { name: "次へ進める" }).click();
    await expect(item.getByText("進行中")).toBeVisible();

    // 進行: 進行中 → 完了（完了になると「次へ進める」ボタンが消える）
    await item.getByRole("button", { name: "次へ進める" }).click();
    await expect(item.getByText("完了")).toBeVisible();
    await expect(item.getByRole("button", { name: "次へ進める" })).not.toBeVisible();

    // 削除
    await item.getByRole("button", { name: "削除" }).click();
    await expect(item).not.toBeVisible();
  });

  test("未認証で /tasks にアクセスすると /signin へリダイレクトされる", async ({ browser }) => {
    // cookie を注入していない素のコンテキスト
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    await page.goto("/tasks");
    await page.waitForURL("**/signin**");
    await anonymous.close();
  });
});
