import { AsyncLocalStorage } from "node:async_hooks";

import type { AppType } from "api-service";
import { hc } from "hono/client";

// セッション検証後に必要な最小限のユーザー型。
export type SessionUser = { id: string; email: string; name: string };

export type ApiClient = ReturnType<typeof hc<AppType>>;

// SSR の serverFn から api-service を呼ぶための Hono RPC クライアントを注入する。CF Workers では
// 同一オリジンへの HTTP ループバックが使えないため、server.ts がリクエストごとに構築した Hono アプリの
// app.request を fetch として束ねた hc クライアントを AsyncLocalStorage で渡す。container を直接呼ばず
// HTTP 境界を通す理由（認証・バリデータ・アクセスログを SSR 経路にも通す）を含め、経緯は ADR-001 の案 D。

type HonoAppLike = {
  request: (input: RequestInfo | URL, requestInit?: RequestInit) => Response | Promise<Response>;
};

const storage = new AsyncLocalStorage<ApiClient>();

// onSetCookie は in-process で呼んだ API の Set-Cookie を受け取る。api-service はセッション検証のついでに
// 有効期限を延ばした session_token と cookieCache を Set-Cookie で返すが、ここで呼んだ応答はブラウザに
// 届かないので、呼び出し側（server.ts）が集めて外側のレスポンスに付ける。付けないと、SSR だけで
// 画面を行き来している間は cookie が延びず、サインインから 7 日で切れる。
export function createInProcessApiClient(
  app: HonoAppLike,
  requestId?: string,
  onSetCookie?: (setCookieHeaders: string[]) => void,
): ApiClient {
  const injected: Record<string, string> = {};
  // SSR 起点の API 呼び出しを outer リクエストと同じ requestId で相関させる
  // （api-service の requestId ミドルウェアは既存の x-request-id ヘッダーを尊重する）
  if (requestId) {
    injected["x-request-id"] = requestId;
  }
  // 注入は hc の `headers` オプションではなく fetch ラッパーで行う。hono client は
  // per-call の `init` を fetch オプションへ後から spread する(`{ headers, ...opt?.init }` —
  // hono/dist/client/client.js)ため、serverFn が cookie 転送のために `init.headers` を渡すと
  // クライアント生成時の headers が丸ごと上書きされて消える（requestId 相関がサイレントに
  // 失われる）。最終的な RequestInit にマージすることで、どの呼び出し方でも注入ヘッダーが
  // 生き残る。
  return hc<AppType>("http://internal", {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      for (const [key, value] of Object.entries(injected)) {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      }
      const response = await app.request(input, { ...init, headers });
      const setCookieHeaders = response.headers.getSetCookie();
      if (setCookieHeaders.length > 0) {
        onSetCookie?.(setCookieHeaders);
      }
      return response;
    },
  });
}

export function runWithApiClient<T>(client: ApiClient, fn: () => Promise<T>): Promise<T> {
  return storage.run(client, fn);
}

// SSR は全実行モード（vite dev / vite preview / wrangler / 本番）で server.ts が worker
// エントリとして動くため、ALS は常に設定される（プローブ計測で /api/$ フォールバックが
// どのモードでも発火しないことを確認済み）。未設定はアーキテクチャ違反（server.ts を
// 経由しない実行経路の混入）なので、静かに壊れる HTTP ループバックに落とすのではなく
// ここで明示的に失敗させる。
export function getApiClient(): ApiClient {
  const client = storage.getStore();
  if (!client) {
    throw new Error(
      "API client is not injected. SSR must go through app/server.ts (runWithApiClient).",
    );
  }
  return client;
}
