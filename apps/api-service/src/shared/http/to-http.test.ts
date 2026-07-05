import { describe, expect, test } from "bun:test";

import { Hono } from "hono";
import { err, ok } from "neverthrow";

import { toHttp } from "./to-http";

describe("toHttp", () => {
  test("ok: 既定 200 で { ok: true, data } を返す", async () => {
    const app = new Hono().get("/", (c) => toHttp(c, ok({ value: 1 }), {}));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { value: 1 } });
  });

  test("ok: okStatus を指定できる（201）", async () => {
    const app = new Hono().get("/", (c) => toHttp(c, ok({ id: "x" }), {}, 201));
    const res = await app.request("/");
    expect(res.status).toBe(201);
  });

  test("err: errorMap のステータスにマップする", async () => {
    const app = new Hono().get("/", (c) => toHttp(c, err("NotFound" as const), { NotFound: 404 }));
    const res = await app.request("/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "NotFound" });
  });

  test("err: errorMap に無いキーは実行時フォールバックで 500 になる", async () => {
    // 型上は errorMap が E を網羅する前提だが、万一の未マップキーは安全網として 500。
    // 網羅漏れを型検査に頼らず実行時にも担保していることを検証する。
    const emptyMap = {} as Record<"Boom", never>;
    const app = new Hono().get("/", (c) => toHttp(c, err("Boom" as const), emptyMap));
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Boom" });
  });
});
