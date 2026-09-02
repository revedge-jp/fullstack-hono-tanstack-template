import { describe, expect, test } from "bun:test";

import { createFakeApp } from "@app/test-helpers/create-fake-app";
import { createLoggerSpy } from "@app/test-helpers/create-logger-spy";

// /api/client-errors の HTTP コントラクト。認証不要・DB 非保存で、通報内容を
// observability ログ(kind に応じた warn/error)へ流すことだけを契約とする。

function postReport(app: ReturnType<typeof createFakeApp>, body: unknown) {
  return app.request("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/client-errors", () => {
  test("正常: 204 を返し、グローバルハンドラ由来は warn でログされる", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({ logger: spy.logger });
    const res = await postReport(app, {
      kind: "unhandledrejection",
      message: "boom",
      path: "/tasks",
    });
    expect(res.status).toBe(204);
    const reported = spy.warn.find(([, msg]) => msg === "client error reported");
    expect(reported?.[0]).toMatchObject({
      event: "client_error",
      kind: "unhandledrejection",
      clientMessage: "boom",
      clientPath: "/tasks",
    });
  });

  test("react-error-boundary は error レベル + error キーでログされる（CF の Errors に載せる）", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({ logger: spy.logger });
    const res = await postReport(app, { kind: "react-error-boundary", message: "crashed" });
    expect(res.status).toBe(204);
    const reported = spy.error.find(([, msg]) => msg === "client error reported");
    expect(reported?.[0]).toMatchObject({ kind: "react-error-boundary", error: "crashed" });
  });

  test("認証なしで通る（サインイン前のエラーも通報できる）", async () => {
    const app = createFakeApp({
      getSession: () => {
        throw new Error("getSession must not be called");
      },
    });
    const res = await postReport(app, { kind: "error", message: "x" });
    expect(res.status).toBe(204);
  });

  test("400: message 欠落・不正な kind はスキーマで弾く", async () => {
    const app = createFakeApp();
    expect((await postReport(app, { kind: "error" })).status).toBe(400);
    expect((await postReport(app, { kind: "invalid-kind", message: "x" })).status).toBe(400);
  });

  test("400: 長さ上限超過（message 1000 超）は弾く", async () => {
    const app = createFakeApp();
    const res = await postReport(app, { kind: "error", message: "a".repeat(1001) });
    expect(res.status).toBe(400);
  });
});
