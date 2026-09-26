import { expect, type Page, test } from "@playwright/test";

import { type SeededUser, seedSignedInUser } from "./helpers/auth";

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

  test("HTML レスポンスにセキュリティヘッダーが付与される", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});

// CSP でスクリプトが止められていないかを見る。本番（prod-shape）はインラインスクリプトを nonce でだけ許すので、
// nonce の付かないスクリプトが 1 つでもあるとハイドレーションが止まり、画面は出るのに操作できなくなる
function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Content-Security-Policy|Refused to (execute|load)/i.test(text)) {
      violations.push(text);
    }
  });
  page.on("pageerror", (error) => violations.push(`pageerror: ${error.message}`));
  return violations;
}

test.describe("CSP", () => {
  let user: SeededUser;

  test.beforeAll(async () => {
    user = await seedSignedInUser("csp");
  });

  test.afterAll(async () => {
    await user.cleanup();
  });

  test("主要なページで CSP の違反が出ない", async ({ context, page }) => {
    const violations = collectCspViolations(page);

    await page.goto("/signin");
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();

    await user.signIn(context);
    for (const path of ["/", "/tasks", "/about"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }

    expect(violations).toEqual([]);
  });

  test("本番は script-src をリクエストごとの nonce で許し、'unsafe-inline' を使わない", async ({
    page,
  }) => {
    test.skip(!process.env.E2E_PROD_SHAPE, "dev は vite のために 'unsafe-inline' を許している");
    const first = await page.goto("/signin");
    const csp = first?.headers()["content-security-policy"] ?? "";
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    const second = await page.goto("/signin");
    const secondCsp = second?.headers()["content-security-policy"] ?? "";
    expect(secondCsp).not.toBe(csp);
  });
});
