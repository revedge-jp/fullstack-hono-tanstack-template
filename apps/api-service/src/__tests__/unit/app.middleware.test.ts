import { describe, expect, test } from "bun:test";

import { createFakeApp } from "api-service/test-helpers";

describe("createApp middleware stack — via createFakeApp", () => {
  test("未知パス: 404 + { ok: false, error: 'Not Found' }", async () => {
    const app = createFakeApp();
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not Found" });
  });

  test("secureHeaders: セキュリティヘッダが付与される", async () => {
    const app = createFakeApp();
    const res = await app.request("/");
    // secureHeaders() の代表的なヘッダ。存在だけを確認する（値の詳細は hono 側の責務）。
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.has("x-frame-options")).toBe(true);
  });

  test("requestId: x-request-id レスポンスヘッダが付与される", async () => {
    const app = createFakeApp();
    const res = await app.request("/");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("CORS: 許可オリジンからのプリフライトに CORS ヘッダを返す", async () => {
    const app = createFakeApp({ corsOrigin: "http://localhost:3000" });
    const res = await app.request("/api/tasks", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("bodyLimit: 1MiB 超のボディは 413 + { error: 'Payload Too Large' }", async () => {
    const app = createFakeApp();
    const oversized = "a".repeat(1024 * 1024 + 1);
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: oversized }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: "Payload Too Large" });
  });

  test("rateLimit: /api/auth/* は上限超過で 429 を返す", async () => {
    const app = createFakeApp({ rateLimit: { windowMs: 60_000, max: 2 } });
    const headers = { "CF-Connecting-IP": "9.9.9.9" };
    const ok1 = await app.request("/api/auth/session", { headers });
    const ok2 = await app.request("/api/auth/session", { headers });
    const blocked = await app.request("/api/auth/session", { headers });
    expect(ok1.status).toBe(200);
    expect(ok2.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ ok: false, error: "Too Many Requests" });
  });

  describe("onError: 500 の形状と環境別マスキング", () => {
    // getSession を throw させ、requireAuth 経由で onError に到達させる。
    const boom = () => {
      throw new Error("boom-secret-detail");
    };

    test("production: message をマスクし detail を含めない", async () => {
      const app = createFakeApp({ nodeEnv: "production", getSession: boom });
      const res = await app.request("/api/tasks");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Internal Server Error");
      expect(body.requestId).toBeTruthy();
      expect(body.detail).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("boom-secret-detail");
    });

    test("development: detail（スタック等）を含める", async () => {
      const app = createFakeApp({ nodeEnv: "development", getSession: boom });
      const res = await app.request("/api/tasks");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal Server Error");
      expect(body.requestId).toBeTruthy();
      expect(typeof body.detail).toBe("string");
      expect(body.detail).toContain("boom-secret-detail");
    });
  });
});
