import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { toActionResult } from "./action-error";
import { resetClientErrorReportingForTest } from "./report-client-error";

// 通報は本物の report-client-error を通し、/api/client-errors への送信内容で確かめる。
// mock.module で差し替えると同一プロセスで後に読み込まれる report-client-error.test.ts に漏れる。
let reportedMessages: string[] = [];
const originalFetch = globalThis.fetch;

type Body = { ok: true } | { ok: false; error: "Conflict" | "Unexpected" };

function respond(ok: boolean, body: unknown) {
  return () => Promise.resolve({ ok, json: (): Promise<Body> => Promise.resolve(body as Body) });
}

const options = {
  messages: { Conflict: "既にあります" },
  fallback: "失敗しました",
};

describe("toActionResult", () => {
  beforeEach(() => {
    reportedMessages = [];
    resetClientErrorReportingForTest();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { pathname: "/tasks" } },
    });
    globalThis.fetch = mock(async (_url: string, init?: { body?: string }) => {
      reportedMessages.push(String(JSON.parse(init?.body ?? "{}").message));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // @ts-expect-error テスト後片付け
    delete globalThis.window;
  });

  test("正常: レスポンスが ok なら { ok: true }", async () => {
    expect(await toActionResult(respond(true, { ok: true }), options)).toEqual({ ok: true });
  });

  test("異常: 対応表にあるコードは日本語の文言に置き換える", async () => {
    const result = await toActionResult(respond(false, { ok: false, error: "Conflict" }), options);
    expect(result).toEqual({ ok: false, message: "既にあります" });
  });

  test.each([
    ["Unexpected", "サーバーでエラーが発生しました。時間をおいて再度お試しください"],
    ["Internal Server Error", "サーバーでエラーが発生しました。時間をおいて再度お試しください"],
    [
      "Unauthorized",
      "ログインの有効期限が切れました。ページを再読み込みしてログインし直してください",
    ],
    ["Too Many Requests", "操作が集中しています。しばらく待ってから再度お試しください"],
    ["Payload Too Large", "送信内容が大きすぎます"],
  ])("異常: ルートの型に無い共通コード %s は共通の文言", async (code, message) => {
    const result = await toActionResult(respond(false, { ok: false, error: code }), options);
    expect(result).toEqual({ ok: false, message });
  });

  test("異常: 対応表にも共通にも無いコードは生のコードを出さず fallback", async () => {
    const result = await toActionResult(respond(false, { ok: false, error: "Not Found" }), options);
    expect(result).toEqual({ ok: false, message: "失敗しました" });
  });

  test("異常: 本文が想定外の形（zValidator の 400 等）は fallback", async () => {
    const body = { success: false, error: { name: "ZodError" } };
    expect(await toActionResult(respond(false, body), options)).toEqual({
      ok: false,
      message: "失敗しました",
    });
  });

  test("異常: 本文が JSON でない（json() が reject）なら fallback", async () => {
    const request = () =>
      Promise.resolve({
        ok: false,
        json: (): Promise<Body> => Promise.reject(new SyntaxError("Unexpected token '<'")),
      });
    expect(await toActionResult(request, options)).toEqual({ ok: false, message: "失敗しました" });
    expect(reportedMessages).toEqual(["action response is not JSON: Unexpected token '<'"]);
  });

  test("異常: 呼び出し自体が reject（通信失敗）しても reject せず通信エラーの文言を返す", async () => {
    const request = () =>
      Promise.reject<{ ok: boolean; json: () => Promise<Body> }>(new TypeError("Failed to fetch"));
    expect(await toActionResult(request, options)).toEqual({
      ok: false,
      message: "通信に失敗しました。接続を確認して再度お試しください",
    });
    expect(reportedMessages).toEqual(["action request failed: Failed to fetch"]);
  });

  test("異常: API が返したエラー（4xx/5xx の JSON）は通報しない（サーバー側で記録済み）", async () => {
    await toActionResult(respond(false, { ok: false, error: "Conflict" }), options);
    await toActionResult(respond(false, { ok: false, error: "Unexpected" }), options);
    expect(reportedMessages).toEqual([]);
  });

  test("異常: プロトタイプのキー名（toString 等）のコードでも関数を拾わず fallback", async () => {
    const result = await toActionResult(respond(false, { ok: false, error: "toString" }), options);
    expect(result).toEqual({ ok: false, message: "失敗しました" });
  });
});
