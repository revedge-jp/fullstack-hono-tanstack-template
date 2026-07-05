import { describe, expect, test } from "bun:test";

import { Hono } from "hono";

import { rateLimit } from "./rate-limit";

function appWith(options: Parameters<typeof rateLimit>[0]) {
  return new Hono().use("*", rateLimit(options)).get("/", (c) => c.json({ ok: true }));
}

const ipHeaders = { "CF-Connecting-IP": "1.2.3.4" };

describe("rateLimit middleware", () => {
  test("上限内は 200 を返し、残数ヘッダが減っていく", async () => {
    const app = appWith({ windowMs: 60_000, max: 3 });
    const first = await app.request("/", { headers: ipHeaders });
    expect(first.status).toBe(200);
    expect(first.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("2");

    const second = await app.request("/", { headers: ipHeaders });
    expect(second.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  test("上限超過で 429 + Retry-After + { error: 'Too Many Requests' }", async () => {
    const app = appWith({ windowMs: 60_000, max: 2 });
    await app.request("/", { headers: ipHeaders });
    await app.request("/", { headers: ipHeaders });
    const blocked = await app.request("/", { headers: ipHeaders });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({ ok: false, error: "Too Many Requests" });
  });

  test("キー（クライアント）ごとに独立してカウントする", async () => {
    const app = appWith({ windowMs: 60_000, max: 1 });
    const a1 = await app.request("/", { headers: { "CF-Connecting-IP": "10.0.0.1" } });
    const a2 = await app.request("/", { headers: { "CF-Connecting-IP": "10.0.0.1" } });
    const b1 = await app.request("/", { headers: { "CF-Connecting-IP": "10.0.0.2" } });
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);
    expect(b1.status).toBe(200);
  });

  test("ウィンドウ経過後にカウントがリセットされる", async () => {
    // windowMs=0 は「毎リクエストで即リセット」に相当する（resetAt <= now が常に真）。
    const app = appWith({ windowMs: 0, max: 1 });
    const first = await app.request("/", { headers: ipHeaders });
    const second = await app.request("/", { headers: ipHeaders });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  test("keyGenerator を差し替えられる", async () => {
    const app = new Hono()
      .use("*", rateLimit({ windowMs: 60_000, max: 1, keyGenerator: () => "everyone" }))
      .get("/", (c) => c.json({ ok: true }));
    const first = await app.request("/", { headers: { "CF-Connecting-IP": "10.0.0.1" } });
    const second = await app.request("/", { headers: { "CF-Connecting-IP": "10.0.0.2" } });
    expect(first.status).toBe(200);
    // 別 IP でも同一キーに畳まれるため 2 回目でブロックされる
    expect(second.status).toBe(429);
  });
});
