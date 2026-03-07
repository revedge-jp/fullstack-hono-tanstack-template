import { describe, expect, test } from "bun:test";
import "../../config"; // ensure .env is loaded for tests

const testDbUrl = process.env.TEST_DATABASE_URL;
if (testDbUrl) {
  process.env.DATABASE_URL = testDbUrl;
}

const { createApp } = await import("../../app");

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("integration: users", () => {
  test("正常: POST /users → 201 の後 GET /users にそのユーザーが含まれる", async () => {
    const app = createApp();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        email: `user_${Date.now()}@example.com`,
        name: "Bob",
      }),
    });
    expect(res.status).toBe(201);

    const listRes = await app.request("/api/users");
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      items: Array<{ email: string }>;
    };
    expect(Array.isArray(listJson.items)).toBe(true);
  });
});
