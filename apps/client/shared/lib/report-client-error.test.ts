import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  reportHandledError,
  installClientErrorReporting,
  reportReactError,
  resetClientErrorReportingForTest,
} from "./report-client-error";

type Captured = { url: string; body: Record<string, unknown> };

let captured: Captured[] = [];
// installClientErrorReporting が登録したグローバルハンドラを掴む。
let winHandlers: Record<string, (event: unknown) => void> = {};
let addEventListenerCount = 0;
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

function mockFetch(status: number): void {
  globalThis.fetch = mock(async (url: string, init?: { body?: string }) => {
    captured.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

function setPathname(pathname: string): void {
  (globalThis as unknown as { window: { location: { pathname: string } } }).window.location = {
    pathname,
  };
}

beforeEach(() => {
  captured = [];
  winHandlers = {};
  addEventListenerCount = 0;
  resetClientErrorReportingForTest();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { pathname: "/shops/11111111-2222-3333-4444-555555555555/sales" },
      addEventListener: (type: string, cb: (event: unknown) => void) => {
        addEventListenerCount += 1;
        winHandlers[type] = cb;
      },
    },
  });
  mockFetch(204);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  // @ts-expect-error テスト後片付け
  delete globalThis.window;
});

describe("reportReactError", () => {
  test("POST 先・種別・パス(UUIDは:idに畳む)を送る", () => {
    reportReactError(new Error("boom"));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("/api/client-errors");
    expect(captured[0]?.body).toMatchObject({
      kind: "react-error-boundary",
      message: "boom",
      path: "/shops/:id/sales",
    });
  });

  test("message/stack の PII(メール・数字列・空白区切りの番号)をスクラブする", () => {
    const err = new Error("failed for taro@example.com id 090-1234-5678 alt 090 1234 5678");
    err.stack = "Error: patient 12345678901 at Foo";
    reportReactError(err);
    const body = captured[0]?.body ?? {};
    expect(body.message).toBe("failed for [email] id [number] alt [number]");
    expect(String(body.stack)).toContain("[number]");
    expect(String(body.message)).not.toContain("taro@example.com");
  });

  test("長すぎるパスは client 側で 500 文字に切り詰める", () => {
    setPathname(`/x/${"a".repeat(1000)}`);
    reportReactError(new Error("boom"));
    expect(String(captured[0]?.body.path).length).toBeLessThanOrEqual(500);
  });

  test("同一エラーの連発(同じ error object=同じ stack)は窓内で1件に畳む(dedup)", () => {
    const err = new Error("same");
    reportReactError(err);
    reportReactError(err);
    reportReactError(err);
    expect(captured).toHaveLength(1);
  });

  test("dedup 窓を過ぎたら再通報して頻度を可視化する", () => {
    let fakeNow = 1_000_000;
    Date.now = () => fakeNow;
    const err = new Error("recurring");
    reportReactError(err);
    reportReactError(err); // 窓内 → 抑制
    expect(captured).toHaveLength(1);
    fakeNow += 5 * 60_000 + 1; // dedup 窓を超える
    reportReactError(err);
    expect(captured).toHaveLength(2); // 再通報
  });

  test("同じ message/stack なら重要度が上がらない限り二重送信しない", () => {
    const err = new Error("dup");
    // react-error-boundary(重要度2)が先
    reportReactError(err);
    // window.onerror(重要度1)が後 → 抑制
    installClientErrorReporting();
    winHandlers.error?.({ message: "dup", error: err });
    expect(captured).toHaveLength(1);
  });

  test("後からより重要な kind(クラッシュ)が届いたら1回だけ通す", () => {
    const err = new Error("crash");
    installClientErrorReporting();
    // window.onerror(重要度1)が先
    winHandlers.error?.({ message: "crash", error: err });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.kind).toBe("error");
    // 同じエラーが error boundary(重要度2)から届く → アップグレードとして通す
    reportReactError(err);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.body.kind).toBe("react-error-boundary");
  });

  test("5分窓あたり20件を上限に間引く", () => {
    for (let i = 0; i < 25; i++) {
      reportReactError(new Error(`unique-${i}`));
    }
    expect(captured).toHaveLength(20);
  });

  test("窓を超えたら通報を再開する(常時開きっぱなしタブでも黙らない・#329 レビュー #1)", () => {
    let fakeNow = 1_000_000;
    Date.now = () => fakeNow;
    for (let i = 0; i < 20; i++) {
      reportReactError(new Error(`w-${i}`));
    }
    expect(captured).toHaveLength(20);
    reportReactError(new Error("still-in-window"));
    expect(captured).toHaveLength(20); // 窓内なのでブロック
    fakeNow += 5 * 60_000 + 1; // 窓を超える
    reportReactError(new Error("after-window"));
    expect(captured).toHaveLength(21); // 再開
  });

  test("送信失敗はレート枠を消費しない(失敗続きでも後続がブロックされない・#329 レビュー #2)", async () => {
    mockFetch(500); // 常に失敗
    for (let i = 0; i < 25; i++) {
      reportReactError(new Error(`fail-${i}`));
      // 失敗スロットの解放(fetch .then)を流す
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // 失敗はロールバックされるので 20 で頭打ちにならない
    expect(captured.length).toBeGreaterThan(20);
  });

  test("fetch が例外を投げてもユーザー操作に伝播させない(throw しない)", () => {
    globalThis.fetch = mock(() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(() => reportReactError(new Error("boom"))).not.toThrow();
  });
});

describe("reportHandledError", () => {
  test("握り潰したエラーを kind: error として context 付きで通報する", () => {
    reportHandledError(new Error("boom"), "signOut failed");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("/api/client-errors");
    expect(captured[0]?.body).toMatchObject({
      kind: "error",
      message: "signOut failed: boom",
    });
  });

  test("Error 以外を渡しても文字列化して通報する", () => {
    reportHandledError("plain string", "somewhere");
    expect(captured[0]?.body).toMatchObject({ message: "somewhere: plain string" });
  });
});

describe("installClientErrorReporting", () => {
  test("window 'error' を通報し、message 無しのリソースエラーは無視する", () => {
    installClientErrorReporting();
    winHandlers.error?.({ message: "boom", error: new Error("boom") });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body).toMatchObject({ kind: "error", message: "boom" });
    // <img>/<script> の読み込み失敗は message を持たない → 送らない
    winHandlers.error?.({ message: "" });
    expect(captured).toHaveLength(1);
  });

  test("unhandledrejection: Error / message を持つオブジェクト / 非オブジェクトを扱う", () => {
    installClientErrorReporting();
    winHandlers.unhandledrejection?.({ reason: new Error("rejected") });
    winHandlers.unhandledrejection?.({ reason: { code: "X", message: "custom reason" } });
    winHandlers.unhandledrejection?.({ reason: "string reason" });
    winHandlers.unhandledrejection?.({ reason: null }); // → 既定文言
    expect(captured.map((c) => c.body.message)).toEqual([
      "rejected",
      "custom reason",
      "string reason",
      "unhandledrejection",
    ]);
  });

  test("二重呼び出しでもリスナを重複登録しない", () => {
    installClientErrorReporting();
    installClientErrorReporting();
    // error + unhandledrejection の2本のみ(4本にならない)
    expect(addEventListenerCount).toBe(2);
  });
});
