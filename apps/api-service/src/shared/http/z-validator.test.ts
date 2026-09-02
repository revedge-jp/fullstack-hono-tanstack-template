import { describe, expect, test } from "bun:test";

import { createLoggerSpy } from "@app/test-helpers/create-logger-spy";
import type { LoggerSpy } from "@app/test-helpers/create-logger-spy";
import { Hono } from "hono";
import { z } from "zod";

import { zValidator } from "./z-validator";

const BodySchema = z.object({
  taskId: z.uuid(),
  title: z.string().min(1),
  price: z.coerce.number().int().nonnegative(),
});

const BulkSchema = z.object({ ids: z.array(z.uuid()) });

// requestLogger ミドルウェアの代わりにスパイロガーを context へ載せた最小アプリを組む。
// 本物のミドルウェアスタックを通す経路は __tests__/unit/router.validation.test.ts の
// sales のケース(createFakeApp)が担っており、ここではラッパー単体の挙動だけを検証する。
function createTestApp(spy: LoggerSpy | undefined) {
  return new Hono()
    .use(async (c, next) => {
      if (spy) {
        c.set("logger", spy.logger);
      }
      await next();
    })
    .post("/items", zValidator("json", BodySchema), (c) => c.json(c.req.valid("json")))
    .post("/bulk", zValidator("json", BulkSchema), (c) => c.json(c.req.valid("json")))
    .get(
      "/items/:id",
      zValidator("param", z.object({ id: z.uuid() }), (result, c) => {
        if (!result.success) {
          return c.json({ ok: false, error: "NotFound" }, 404);
        }
      }),
      (c) => c.json({ id: c.req.valid("param").id }),
    )
    .get("/raw-items/:id", zValidator("param", z.object({ id: z.uuid() })), (c) =>
      c.json({ id: c.req.valid("param").id }),
    );
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("shared zValidator — バリデーション400の診断ログ", () => {
  test("検証失敗時、path/message を request_validation_failed として warn する", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: VALID_UUID, title: "山田", price: -1 }),
    });

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        { issues: [{ path: "price", message: "Too small: expected number to be >=0" }] },
        "request_validation_failed",
      ],
    ]);
  });

  test("ID系ホワイトリストのフィールドに限り、実際の送信値をログへ残す", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "not-a-uuid", title: "山田", price: 100 }),
    });

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        { issues: [{ path: "taskId", message: "Invalid UUID", value: "not-a-uuid" }] },
        "request_validation_failed",
      ],
    ]);
  });

  test("ホワイトリスト外のフィールド(患者名等のPII)は値をログへ出さない", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: VALID_UUID, title: "", price: 100 }),
    });

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        {
          issues: [{ path: "title", message: "Too small: expected string to have >=1 characters" }],
        },
        "request_validation_failed",
      ],
    ]);
    expect(JSON.stringify(spy.warn)).not.toContain("山田");
  });

  test("パスパラメータの汎用キー id も、実際の送信値をログへ残す", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/raw-items/not-a-uuid");

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        { issues: [{ path: "id", message: "Invalid UUID", value: "not-a-uuid" }] },
        "request_validation_failed",
      ],
    ]);
  });

  test("配列要素は末尾が数値indexでも、配列自体のフィールド名がホワイトリスト対象なら値をログへ残す", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [VALID_UUID, "not-a-uuid"] }),
    });

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        { issues: [{ path: "ids.1", message: "Invalid UUID", value: "not-a-uuid" }] },
        "request_validation_failed",
      ],
    ]);
  });

  // SAFE_TO_LOG_FIELD_NAMES の各エントリを個別に踏む(taskId/id/idsは
  // 上のテストで既に踏んでいる)。1件でも欠けるとホワイトリストへの追加漏れがテストでは
  // 検知できない(実運用由来)。
  test.each(["taskId", "id"])(
    "ホワイトリストのフィールド%sも、実際の送信値をログへ残す",
    async (fieldName) => {
      const spy = createLoggerSpy();
      const schema = z.object({ [fieldName]: z.uuid() });
      const app = new Hono()
        .use(async (c, next) => {
          c.set("logger", spy.logger);
          await next();
        })
        .post("/whitelist-check", zValidator("json", schema), (c) => c.json(c.req.valid("json")));

      const res = await app.request("/whitelist-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldName]: "not-a-uuid" }),
      });

      expect(res.status).toBe(400);
      expect(spy.warn).toEqual([
        [
          { issues: [{ path: fieldName, message: "Invalid UUID", value: "not-a-uuid" }] },
          "request_validation_failed",
        ],
      ]);
    },
  );

  // ホワイトリスト対象のフィールドでも、値が文字列でなければログへ残さない
  // (isWhitelisted=true だけで無条件にログする退行を防ぐ)。
  test("ホワイトリスト対象でも値が文字列でない場合は値をログへ出さない", async () => {
    const spy = createLoggerSpy();
    const schema = z.object({ taskId: z.uuid() });
    const app = new Hono()
      .use(async (c, next) => {
        c.set("logger", spy.logger);
        await next();
      })
      .post("/non-string-check", zValidator("json", schema), (c) => c.json(c.req.valid("json")));

    const res = await app.request("/non-string-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: 12345 }),
    });

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        {
          issues: [{ path: "taskId", message: "Invalid input: expected string, received number" }],
        },
        "request_validation_failed",
      ],
    ]);
  });

  test("呼び出し側 hook の応答(404への変換)はそのまま通し、ログも出す", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/items/not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "NotFound" });
    expect(spy.warn).toHaveLength(1);
    expect(spy.warn[0]?.[1]).toBe("request_validation_failed");
  });

  test("検証成功時は何もログせず、ハンドラへそのまま渡す", async () => {
    const spy = createLoggerSpy();
    const app = createTestApp(spy);

    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: VALID_UUID, title: "山田", price: 100 }),
    });

    expect(res.status).toBe(200);
    expect(spy.warn).toEqual([]);
    expect(spy.info).toEqual([]);
    expect(spy.error).toEqual([]);
  });

  // 以下2つは「本家 zValidator の位置引数契約(第3引数=hook, 第4引数=options)が
  // 変わっていないこと」を固定する回帰テスト。ラッパーは Proxy で引数列を組み替えるため、
  // ライブラリ更新で引数の並び・意味が変わると型チェックを通ったまま実行時に壊れうる。
  // 通常の hook/既定400 は他のテストが押さえており、ここは未使用の経路(async hook・
  // options.validationFunction)を明示的に固定する。
  test("async な hook も await され、その応答がそのまま返る", async () => {
    const spy = createLoggerSpy();
    const app = new Hono()
      .use(async (c, next) => {
        c.set("logger", spy.logger);
        await next();
      })
      .get(
        "/async/:id",
        zValidator("param", z.object({ id: z.uuid() }), async (result, c) => {
          if (!result.success) {
            await Promise.resolve();
            return c.json({ ok: false, error: "NotFound" }, 404);
          }
        }),
        (c) => c.json({ id: c.req.valid("param").id }),
      );

    const res = await app.request("/async/not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "NotFound" });
    expect(spy.warn).toHaveLength(1);
  });

  test("第4引数 options の validationFunction が本家へ委譲される", async () => {
    const spy = createLoggerSpy();
    const schema = z.object({ taskId: z.uuid() });
    const app = new Hono()
      .use(async (c, next) => {
        c.set("logger", spy.logger);
        await next();
      })
      .post(
        "/custom",
        zValidator("json", schema, undefined, {
          validationFunction: () =>
            z
              .object({
                taskId: z.string().refine(() => false, { message: "custom-rejected" }),
              })
              .safeParse({ taskId: "custom-checked" }),
        }),
        (c) => c.json(c.req.valid("json")),
      );

    const res = await app.request("/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: VALID_UUID }),
    });

    expect(res.status).toBe(400);
    expect(spy.warn).toEqual([
      [
        { issues: [{ path: "taskId", message: "custom-rejected", value: VALID_UUID }] },
        "request_validation_failed",
      ],
    ]);
  });

  test("logger が context に無い経路(webhook等)でも失敗応答は壊れない", async () => {
    const app = createTestApp(undefined);

    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "not-a-uuid", title: "山田", price: 100 }),
    });

    expect(res.status).toBe(400);
  });
});
