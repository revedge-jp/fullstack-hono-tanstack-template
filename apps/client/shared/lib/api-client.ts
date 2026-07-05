import { AsyncLocalStorage } from "node:async_hooks";

import type { AppType } from "api-service";
import { hc } from "hono/client";

// セッション検証後に必要な最小限のユーザー型。
export type SessionUser = { id: string; email: string; name: string };

export type ApiClient = ReturnType<typeof hc<AppType>>;

// SSR の serverFn から api-service を呼ぶための Hono RPC クライアントを注入する。
//
// 背景(ADR-001): CF Workers + Static Assets では、同一オリジンへの fetch() サブリクエストは
// Worker の fetch ハンドラーを経由せずアセットハンドラーに落ちて 404 になるため、
// HTTP ループバックが使えない。そこで server.ts がリクエストごとに構築した Hono アプリの
// app.request（インプロセスの関数呼び出し。ネットワークに出ないため上記制約に触れない）を
// fetch として束ねた hc クライアントを AsyncLocalStorage で serverFn に注入する。
//
// container を直接呼ばず HTTP 境界を通すのは意図的: presentation 層の認証ミドルウェア・
// バリデータ・アクセスログを SSR 経路でも通すことで、ブラウザからの経路と意味論を揃え、
// アプリケーション層への入口を1本に保つため。

type HonoAppLike = {
  request: (input: RequestInfo | URL, requestInit?: RequestInit) => Response | Promise<Response>;
};

const storage = new AsyncLocalStorage<ApiClient>();

export function createInProcessApiClient(app: HonoAppLike): ApiClient {
  return hc<AppType>("http://internal", { fetch: app.request.bind(app) });
}

export function runWithApiClient<T>(client: ApiClient, fn: () => Promise<T>): Promise<T> {
  return storage.run(client, fn);
}

// ALS 未設定の環境（server.ts を経由しない素の vite / node 実行）では、
// /api/$ キャッチオールルート経由の同一オリジン HTTP ループバックにフォールバックする。
export function getApiClient(request: Request): ApiClient {
  return storage.getStore() ?? hc<AppType>(new URL(request.url).origin);
}
