import { Hono } from "hono";

/**
 * テスト用の最小 Hono アプリを生成する。
 * 認証ルートのテストには直接 createAuthRouter を使用すること。
 */
export function createFakeApp() {
  const app = new Hono().get("/", (c) => c.json({ ok: true }));

  return app;
}
