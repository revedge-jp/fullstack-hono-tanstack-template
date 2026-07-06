import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { type SeededUser, seedSignedInUser } from "./helpers/auth";

// 静的 lint（oxlint jsx-a11y）では検出できない実行時の問題 — コントラスト比・
// ARIA の実効性・ラベルの結び付き — を axe-core で検査する。基準は WCAG 2.2 AA
// （docs/dev/coding-standards.md のアクセシビリティ方針に対応）。
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scanPage(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => {
    const targets = violation.nodes.map((node) => `  - ${node.target.join(" ")}`).join("\n");
    return `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${targets}`;
  });
}

test.describe("アクセシビリティ (axe-core, WCAG 2.2 AA)", () => {
  test("サインインページに violation がない", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();

    expect(await scanPage(page)).toEqual([]);
  });

  test("タスクページ（一覧アイテムあり）に violation がない", async ({ context, page }) => {
    let user: SeededUser | undefined;
    try {
      user = await seedSignedInUser("a11y-scan");
      await user.signIn(context);

      await page.goto("/tasks");
      await expect(page.getByRole("heading", { name: "タスク" })).toBeVisible();

      // 空状態だけでなくリストアイテム（ステータスバッジ・操作ボタン）も検査対象に含める
      const title = `a11y スキャン用タスク ${Date.now()}`;
      const addButton = page.getByRole("button", { name: "追加" });
      const titleInput = page.getByLabel("タスクのタイトル");
      await expect(async () => {
        await titleInput.fill("");
        await titleInput.fill(title);
        await expect(addButton).toBeEnabled({ timeout: 1000 });
      }).toPass();
      await addButton.click();
      await expect(page.locator("li", { hasText: title })).toBeVisible();

      expect(await scanPage(page)).toEqual([]);
    } finally {
      await user?.cleanup();
    }
  });
});
