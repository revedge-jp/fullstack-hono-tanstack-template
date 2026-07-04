import { describe, expect, test } from "bun:test";

import { type RequestLogger, requestLogger } from "@app/middlewares/request-logger";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

function buildSpyLogger() {
  const entries: { level: string; obj: unknown; msg?: string; bindings: unknown }[] = [];
  function make(bindings: Record<string, unknown>): RequestLogger {
    return {
      info: (obj, msg) => entries.push({ level: "info", obj, msg, bindings }),
      warn: (obj, msg) => entries.push({ level: "warn", obj, msg, bindings }),
      error: (obj, msg) => entries.push({ level: "error", obj, msg, bindings }),
      child: (b) => make({ ...bindings, ...b }),
    };
  }
  return { entries, logger: make({}) };
}

function createTestApp(logger: RequestLogger) {
  return new Hono()
    .use("*", requestId({ headerName: "x-request-id" }))
    .use("*", requestLogger(logger))
    .get("/hello", (c) => c.json({ ok: true }))
    .get("/with-logger", (c) => {
      const log = c.get("logger");
      log?.warn({ marker: "from-handler" }, "handler log");
      return c.json({ ok: true });
    });
}

describe("requestLogger middleware", () => {
  test("アクセスログに method / path / status / durationMs と requestId バインディングが載る", async () => {
    const { entries, logger } = buildSpyLogger();
    const app = createTestApp(logger);

    const res = await app.request("/hello", {
      headers: { "x-request-id": "req-123" },
    });
    expect(res.status).toBe(200);

    const access = entries.find((e) => e.msg === "request");
    expect(access).toBeDefined();
    expect(access?.level).toBe("info");
    expect(access?.bindings).toEqual({ requestId: "req-123" });
    expect(access?.obj).toMatchObject({ method: "GET", path: "/hello", status: 200 });
    const durationMs = (access!.obj as { durationMs: number }).durationMs;
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  test("ハンドラから c.get('logger') で requestId 相関つきロガーが使える", async () => {
    const { entries, logger } = buildSpyLogger();
    const app = createTestApp(logger);

    await app.request("/with-logger", { headers: { "x-request-id": "req-456" } });

    const handlerLog = entries.find((e) => e.msg === "handler log");
    expect(handlerLog).toBeDefined();
    expect(handlerLog?.level).toBe("warn");
    expect(handlerLog?.bindings).toEqual({ requestId: "req-456" });
  });
});
