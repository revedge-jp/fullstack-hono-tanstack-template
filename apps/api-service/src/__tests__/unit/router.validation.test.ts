import { describe, expect, test } from "bun:test";
import "../../config"; // ensure .env is loaded early
const testDbUrl = process.env.TEST_DATABASE_URL;
if (testDbUrl) {
  process.env.DATABASE_URL = testDbUrl;
}
const { createApp } = await import("../../app");

describe("router: バリデーション失敗", () => {
  test("POST /users: 不正なペイロードで 400 を返す", async () => {
    const app = createApp();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email: "not-an-email", name: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("PATCH /users/:id: 不正なペイロードで 400 を返す", async () => {
    const app = createApp();
    const res = await app.request("/api/users/550e8400-e29b-41d4-a716-446655440000", {
      method: "PATCH",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /users/:id: 不正な UUID で 400 または 404 を返す", async () => {
    const app = createApp();
    const res = await app.request("/api/users/abc");
    expect([400, 404]).toContain(res.status);
  });
});
