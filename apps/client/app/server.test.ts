import { describe, expect, test } from "bun:test";

import { createInProcessApiClient } from "@/shared/lib/api-client";

import server, { releaseAfterResponse, withSecurityHeaders } from "./server";

// 「Response オブジェクトを返した時点」で cleanup を走らせると、ストリーミング
// レスポンスの送信中に裏で実行中のクエリのDB接続が閉じられ、同時リクエストが多い環境で
// CONNECTION_ENDED の500が発生する。cleanup はボディの送信完了(またはキャンセル)後まで
// 遅延させる必要がある。

describe("releaseAfterResponse", () => {
  test("bodyが無いレスポンスは即座にcleanupを実行する", async () => {
    let cleanupCalled = false;
    const waited: Promise<unknown>[] = [];
    const response = new Response(null, { status: 204 });
    releaseAfterResponse(
      response,
      () => {
        cleanupCalled = true;
        return Promise.resolve();
      },
      (p) => waited.push(p),
    );
    await Promise.all(waited);
    expect(cleanupCalled).toBe(true);
  });

  test("bodyがあるレスポンスは、ボディの読み取りが完了するまでcleanupを呼ばない", async () => {
    const events: string[] = [];
    let unblock: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const originalBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-1"));
        await blocker;
        controller.enqueue(new TextEncoder().encode("chunk-2"));
        controller.close();
      },
    });
    const originalResponse = new Response(originalBody);

    const waited: Promise<unknown>[] = [];
    const wrapped = releaseAfterResponse(
      originalResponse,
      () => {
        events.push("cleanup");
        return Promise.resolve();
      },
      (p) => waited.push(p),
    );

    // まだ全ボディを読み切っていない段階ではcleanupは呼ばれない。
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([]);

    unblock();
    const text = await wrapped.text();
    await Promise.all(waited);

    expect(text).toBe("chunk-1chunk-2");
    expect(events).toEqual(["cleanup"]);
  });

  test("クライアントが読み取りを途中でキャンセルしてもcleanupは呼ばれる", async () => {
    let cleanupCalled = false;
    const originalBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-1"));
        // 意図的にcloseしない(クライアントのキャンセルをシミュレートするため)。
      },
    });
    const originalResponse = new Response(originalBody);

    const waited: Promise<unknown>[] = [];
    const wrapped = releaseAfterResponse(
      originalResponse,
      () => {
        cleanupCalled = true;
        return Promise.resolve();
      },
      (p) => waited.push(p),
    );

    const reader = wrapped.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await Promise.all(waited);

    expect(cleanupCalled).toBe(true);
  });
});

// 静的アセットの取りこぼし。CF assets バインディングでヒットしなかった "/assets/*" は
// SSR ハンドラへ渡さず即座に 404 で返す(渡すと Worker がハングする)。DB/Hono アプリ
// 初期化前に早期 return するため、DB 接続なしでそのままテストできる。
describe("静的アセットの取りこぼし(/assets/*)", () => {
  test("現在のビルドに存在しないアセットは即座に404を返す(SSRハンドラへ渡さない)", async () => {
    const res = await server.fetch(
      new Request("https://app.example.com/assets/index-STALE123.js"),
      {},
      undefined,
    );
    expect(res.status).toBe(404);
  });
});

// server.ts が SSR に注入する in-process クライアントのヘッダー注入契約。
// hono client は per-call の `init` を fetch オプションへ後から spread するため、hc の
// `headers` オプションで注入したヘッダーは `init.headers` を渡す呼び出し(cookie 転送する
// serverFn)で丸ごと消える。fetch ラッパーでのマージに変更した回帰テスト。
describe("createInProcessApiClient のヘッダー注入", () => {
  type Captured = { url: string; headers: Headers };

  function createCapturingApp(captured: Captured[]) {
    return {
      request: (input: RequestInfo | URL, requestInit?: RequestInit) => {
        captured.push({
          url: String(input),
          headers: new Headers(requestInit?.headers),
        });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    };
  }

  test("per-call の init.headers(cookie転送)と共存して注入ヘッダーが届く", async () => {
    const captured: Captured[] = [];
    const client = createInProcessApiClient(createCapturingApp(captured), "rid-1");

    // 実際の serverFn と同じ呼び出し方: init.headers で cookie を渡す
    await client.api.tasks.$get({ query: {} }, { init: { headers: { cookie: "a=b" } } });

    expect(captured).toHaveLength(1);
    const headers = captured[0]!.headers;
    expect(headers.get("cookie")).toBe("a=b");
    expect(headers.get("x-request-id")).toBe("rid-1");
  });

  test("init.headers 無しの呼び出しでも注入ヘッダーが届く", async () => {
    const captured: Captured[] = [];
    const client = createInProcessApiClient(createCapturingApp(captured), "rid-2");

    await client.api.health.$get();

    const headers = captured[0]!.headers;
    expect(headers.get("x-request-id")).toBe("rid-2");
  });

  test("呼び出し側が同名ヘッダーを明示した場合はそちらを優先する(上書きしない)", async () => {
    const captured: Captured[] = [];
    const client = createInProcessApiClient(createCapturingApp(captured), "rid-3");

    await client.api.tasks.$get(
      { query: {} },
      { init: { headers: { "x-request-id": "explicit" } } },
    );

    const headers = captured[0]!.headers;
    expect(headers.get("x-request-id")).toBe("explicit");
  });
});

describe("withSecurityHeaders", () => {
  test("CSP・no-store・requestId が SSR レスポンスに付く", () => {
    const res = withSecurityHeaders(new Response("ok"), true, "req-1");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("x-request-id")).toBe("req-1");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  test("開発では vite 向けの緩和(unsafe-eval / ws:)が入り、HSTS は付かない", () => {
    const res = withSecurityHeaders(new Response("ok"), false);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws: wss:");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });
});
