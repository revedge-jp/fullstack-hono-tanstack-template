import { readCauseCode, stringifyErrorSafe, stripBindParamsFromStack } from "@repo/logging";
import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";

import { createInProcessApiClient, runWithApiClient } from "@/shared/lib/api-client";
import { initHonoApp } from "@/shared/lib/hono-app";
import { serverLogger } from "@/shared/lib/server-logger";

import { createCspNonce, runWithCspNonce } from "./csp-nonce";

const handler = createStartHandler(defaultRenderHandler);

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      // SSR のリダイレクト (throw redirect()) はストリームを中断する — 想定通りの動作。
      // event.preventDefault() で CF Workers ランタイムのデフォルトログも抑制する。
      if (reason.message.startsWith("Stream was cancelled")) {
        event.preventDefault();
        return;
      }
      // Better Auth が OAuth callback の 302 リダイレクト処理後に内部で再スローする
      // APIError。メッセージなし・ログイン成功に影響なし — 無視する。
      if (reason.name === "APIError" && !reason.message) {
        event.preventDefault();
        return;
      }
      // DB 由来の Error（DrizzleQueryError）は message・stack・cause にバインド値を持つので、そのまま出さない
      // （.claude/rules/logging.md）。api-service の onError と同じく切り落とした文字列と SQLSTATE だけにする
      serverLogger.error(
        {
          err: stringifyErrorSafe(reason),
          causeCode: readCauseCode(reason),
          stack: safeStack(reason),
        },
        "unhandled rejection",
      );
    } else {
      serverLogger.error({ err: stringifyErrorSafe(reason) }, "unhandled rejection (non-Error)");
    }
  });
}

type CFContext = { waitUntil: (p: Promise<unknown>) => void } | undefined;
function safeStack(e: unknown): string | undefined {
  return e instanceof Error && e.stack ? stripBindParamsFromStack(e.stack, e.message) : undefined;
}

type CFBindings = Record<string, string | { connectionString: string } | undefined>;

// 未設定は本番扱い（api-service の config.ts と同じ fail-closed）。開発扱いに倒すと、NODE_ENV を
// 渡し忘れたデプロイで 500 の本文にスタックが出て、CSP が緩み、HSTS が付かない。
// ローカルは .env（.dev.vars）の NODE_ENV=development で明示する。development / test 以外
// （"staging" や空文字などの想定外の値）も本番側に倒す。
export function isProductionEnv(env: { NODE_ENV?: string } | undefined): boolean {
  const nodeEnv = env?.NODE_ENV;
  return nodeEnv !== "development" && nodeEnv !== "test";
}

// SSR（非 /api/*）レスポンス用のセキュリティヘッダー。/api/* は Hono 側の secureHeaders() が担う。
// 静的アセット（CF assets バインディング直配信）には付かないが、CSP が意味を持つのは HTML なので十分。
export function withSecurityHeaders(
  response: Response,
  isProd: boolean,
  requestId?: string,
  nonce?: string,
): Response {
  const csp = [
    "default-src 'self'",
    // ビルド済みの Worker はリクエストごとの nonce を付けたインラインスクリプト（ハイドレーションデータ・
    // __root.tsx の head）だけを許す。nonce は router の ssr.nonce 経由ですべてのスクリプトに付く
    // （app/csp-nonce.ts）。nonce の無い応答（SSR の失敗時の 500 等）はインラインスクリプトを含まないので
    // 'self' だけでよい。vite の dev サーバー（nonce を渡さない）はスクリプトを差し込み eval も使うので緩める
    nonce
      ? `script-src 'self' 'nonce-${nonce}'`
      : isProd
        ? "script-src 'self'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // Google Fonts（__root.tsx）を許可。セルフホスト化したらこの2行から外部オリジンを外すこと。
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    // dev は vite HMR の WebSocket を許可
    isProd ? "connect-src 'self'" : "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", csp);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // SSR HTML には認証ユーザーの氏名・メール等が埋め込まれるため、共有・ブラウザキャッシュを禁止する。
  // 静的アセットは CF assets バインディングが直配信しこの関数を通らない（/api/* も早期 return 済み）ので、
  // ここで no-store になるのは SSR ドキュメント／serverFn レスポンスに限られる。
  headers.set("Cache-Control", "private, no-store");
  if (isProd) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (requestId) {
    // ユーザー報告・ブラウザ devtools からログを引けるように SSR レスポンスにも露出する
    headers.set("x-request-id", requestId);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// 古いタブ検知（shared/lib/app-version.ts）の基準にする、この HTML を返した時点のバージョン。
// レスポンスヘッダーは JS から読めないが、Server-Timing はブラウザが performance の navigation エントリで見せる。
// 値の決め方は api-service の x-app-version（config.ts の gitSha）と揃える。揃えないと開いた直後に stale になる
export function appVersionFromEnv(env: { GIT_SHA?: unknown } | undefined): string {
  const sha = env?.GIT_SHA;
  return typeof sha === "string" && sha.trim() ? sha.trim() : "dev";
}

export function withAppVersionTiming(response: Response, version: string): Response {
  // desc は引用符で囲むので、引用符やカンマを含む値は付けない（git SHA / "dev" は該当しない）
  if (!/^[\w.-]+$/.test(version)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.append("Server-Timing", `app;desc="${version}"`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Set-Cookie は 1 つずつ別のヘッダーとして足す（カンマで結合すると Expires の日付と区別できない）
export function withForwardedSetCookies(
  response: Response,
  setCookieHeaders: readonly string[],
): Response {
  if (setCookieHeaders.length === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const value of setCookieHeaders) {
    headers.append("set-cookie", value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// SSR の loader/createServerFn が api-service をインプロセスで呼べるよう、Hono RPC クライアントを
// AsyncLocalStorage で注入して render を実行する（背景と設計意図は shared/lib/api-client.ts）。
// in-process で呼んだ API の Set-Cookie（セッション延長）を集めて外側のレスポンスに付ける。
// 付けられるのは render がレスポンスを返すまでに呼ばれた分だけ（セッション検証は beforeLoad で
// 先に済むので含まれる）。ストリーミング中に後から呼ばれた分は、ヘッダーを送った後なので付かない
export async function renderWithInProcessApi(
  render: (request: Request) => Response | Promise<Response>,
  honoApp: Parameters<typeof createInProcessApiClient>[0],
  request: Request,
  requestId: string,
): Promise<Response> {
  const forwardedSetCookies: string[] = [];
  const apiClient = createInProcessApiClient(honoApp, requestId, (setCookieHeaders) =>
    forwardedSetCookies.push(...setCookieHeaders),
  );
  const response = await runWithApiClient(apiClient, () => Promise.resolve(render(request)));
  return withForwardedSetCookies(response, forwardedSetCookies);
}

// レスポンスボディの送信完了(またはキャンセル)後に DB 接続を解放する。
// 「Response オブジェクトを返した時点」で cleanup を走らせると、ストリーミング応答
// (SSR)や送信途中のボディの裏で実行中のクエリの接続が閉じられ、同時リクエストが
// 多い環境(CI 等)で CONNECTION_ENDED の 500 が発生する。
export function releaseAfterResponse(
  response: Response,
  cleanup: () => Promise<unknown>,
  waitUntil: (p: Promise<unknown>) => void,
): Response {
  if (!response.body) {
    waitUntil(cleanup());
    return response;
  }
  const { readable, writable } = new TransformStream();
  waitUntil(
    response.body
      .pipeTo(writable)
      .catch(() => undefined)
      .then(() => cleanup()),
  );
  return new Response(readable, response);
}

// TanStack Start の SSR ハンドラ(@tanstack/start-server-core createStartHandler.js の
// executeRouter)は、Accept に "*/*" も "text/html" も含まないページ要求
// (例: Accept: application/json で /graphql を探るスキャナ)に
// {"error":"Only HTML requests are supported here"} を **500** で返す。5xx はエラー監視を
// 鳴らすので、SSR へ渡す前に 404 で返すための判定。Accept の判定は上流の写し(未指定は
// "*/*" 扱い、各要素の先頭一致)なので、上流を更新したら突き合わせること。
// /api/* は Hono、/_serverFn/* は serverFn 経路(Accept は application/json 等)なので対象外。
// 前提: server route(routes/*.tsx の `server.handlers`)を /api/ の外に置いていない。上流では
// その handlers は Accept 判定より前に実行されるため、置くならここで除外に加えること。
// serverFn のパスは TanStack Start の既定(serverFns.base = "/_serverFn")。vite.config.ts で
// 変えたらここも合わせること。
export function isNonHtmlPageRequest(pathname: string, accept: string | null): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_serverFn/")) {
    return false;
  }
  const acceptParts = (accept || "*/*").split(",");
  return !["*/*", "text/html"].some((mimeType) =>
    acceptParts.some((part) => part.trim().startsWith(mimeType)),
  );
}

export default {
  async fetch(request: Request, env: CFBindings, ctx: CFContext) {
    const url = new URL(request.url);
    // SSR とそこから発生する API 呼び出しを1つの requestId で相関させる
    // （api-service 側の requestId ミドルウェア・アクセスログと同じ ID になる）。ヘッダー参照
    // のみで副作用が無いため、下の早期 return より前でも安全に計算できる。
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    // ---- 静的アセットの取りこぼし ------------------------------------------
    // "/assets/*" は Vite ビルドが出力するハッシュ付き静的ファイル専用の URL 空間で、
    // TanStack Router 側には対応するルートが一切無い(Vite既定の assetsDir="assets" に依存 —
    // vite.config.ts で build.assetsDir/base を変更したらこのプレフィックスも合わせて直すこと)。
    // ヒットする場合は CF assets バインディングがこのハンドラより先に直配信するため、ここに
    // 到達した時点で「現在のビルドに存在しないアセット」と確定している(デプロイでハッシュが
    // 変わった後、古いHTMLを持つクライアントが要求するケースが典型)。ここでチェックせずに
    // TanStack Start の handler() へ渡すと、ルートに一切マッチしない URL の処理中に Worker が
    // ハングし、CF ランタイムに強制終了されるまで応答が返らない("Worker's code had hung")。
    // /api/* と同じ理由でここも早期 return する。
    if (url.pathname.startsWith("/assets/")) {
      serverLogger.warn({ requestId, path: url.pathname }, "stale asset request");
      return new Response("Not Found", { status: 404 });
    }

    // ---- HTML を受け付けないページリクエスト(isNonHtmlPageRequest 参照) ----------
    // Hono アプリ(postgres.js クライアント)の初期化より前に返す。
    const accept = request.headers.get("accept");
    if (isNonHtmlPageRequest(url.pathname, accept)) {
      serverLogger.warn({ requestId, path: url.pathname, accept }, "non-html page request");
      return new Response("Not Found", { status: 404 });
    }

    // リクエストごとに新しい Hono アプリ（および postgres.js クライアント）を生成する。
    // DB 接続の解放はレスポンスボディの完了後(releaseAfterResponse)。
    // ctx?.waitUntil ?? void p の分岐は、テストランナー等 fetch(request, env) の2引数のみで
    // 呼ばれる呼び出し元(ctx省略)向けのフォールバック。
    // initHonoApp は設定の検証（loadConfig）で throw しうるので try の中で呼ぶ。外にあると設定不備のとき
    // requestId 付きのログもセキュリティヘッダーも無いまま、Cloudflare の 1101 エラーページになる
    let end: (() => Promise<unknown>) | undefined;
    const cleanup = () => (end ? end().catch(() => undefined) : Promise.resolve(undefined));
    const waitUntil = (p: Promise<unknown>) => ctx?.waitUntil(p) ?? void p;
    const isProd = isProductionEnv(env);

    try {
      const initialized = initHonoApp(env ?? {});
      const honoApp = initialized.app;
      end = initialized.end;
      // /api/* は直接 Hono にディスパッチし、TanStack Start を完全にバイパスする。
      if (url.pathname.startsWith("/api/")) {
        const response = await honoApp.fetch(request);
        return releaseAfterResponse(response, cleanup, waitUntil);
      }

      // vite の dev サーバーは自前のスクリプトに nonce を付けないので、ビルド済みのときだけ使う
      const nonce = import.meta.env.DEV ? undefined : createCspNonce();
      const render = () => renderWithInProcessApi(handler, honoApp, request, requestId);
      const response = await (nonce ? runWithCspNonce(nonce, render) : render());
      return releaseAfterResponse(
        withAppVersionTiming(
          withSecurityHeaders(response, isProd, requestId, nonce),
          appVersionFromEnv(env),
        ),
        cleanup,
        waitUntil,
      );
    } catch (e) {
      waitUntil(cleanup());
      // API 側の pino ログと突き合わせられるよう、requestId 付きの構造化ログで出力する
      serverLogger.error(
        { requestId, err: stringifyErrorSafe(e), causeCode: readCauseCode(e), stack: safeStack(e) },
        "ssr unhandled error",
      );
      const body = isProd
        ? `Internal Server Error (requestId: ${requestId})`
        : `Error: ${safeStack(e) ?? stringifyErrorSafe(e)}`;
      return withSecurityHeaders(new Response(body, { status: 500 }), isProd, requestId);
    }
  },
};
