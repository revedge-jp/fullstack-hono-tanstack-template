import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";

import { createInProcessApiClient, runWithApiClient } from "@/shared/lib/api-client";
import { initHonoApp } from "@/shared/lib/hono-app";

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
      console.error("[server] Unhandled rejection:", reason.name, reason.message);
      if (reason.stack) {
        console.error("[server] Stack:", reason.stack);
      }
      if ("cause" in reason) {
        console.error("[server] Cause:", reason.cause);
      }
    } else {
      console.error("[server] Unhandled rejection (non-Error):", reason);
    }
  });
}

type CFContext = { waitUntil: (p: Promise<unknown>) => void } | undefined;
type CFBindings = Record<string, string | { connectionString: string } | undefined>;

// SSR（非 /api/*）レスポンス用のセキュリティヘッダー。/api/* は Hono 側の secureHeaders() が担う。
// 静的アセット（CF assets バインディング直配信）には付かないが、CSP が意味を持つのは HTML なので十分。
function withSecurityHeaders(response: Response, isProd: boolean, requestId?: string): Response {
  const csp = [
    "default-src 'self'",
    // TanStack Start がハイドレーションデータをインラインスクリプトで注入するため 'unsafe-inline' が必要。
    // dev では vite の変換で 'unsafe-eval' も要る。
    isProd
      ? "script-src 'self' 'unsafe-inline'"
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

export default {
  async fetch(request: Request, env: CFBindings, ctx: CFContext) {
    // リクエストごとに新しい Hono アプリ（および postgres.js クライアント）を生成する。
    // ctx.waitUntil(cleanup()) はレスポンス送信後に DB 接続を解放し、
    // CF Workers のイベントループを完了させるために必要。
    // Vite 開発モードでは ctx が undefined のため、fire-and-forget にフォールバックする。
    const { app: honoApp, end } = initHonoApp(env ?? {});
    const cleanup = () => end().catch(() => undefined);
    const waitUntil = (p: Promise<unknown>) => ctx?.waitUntil(p) ?? void p;
    const isProd = env?.NODE_ENV === "production";
    // SSR とそこから発生する API 呼び出しを1つの requestId で相関させる
    // （api-service 側の requestId ミドルウェア・アクセスログと同じ ID になる）。
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // /api/* は直接 Hono にディスパッチし、TanStack Start を完全にバイパスする。
      if (url.pathname.startsWith("/api/")) {
        const response = await honoApp.fetch(request);
        waitUntil(cleanup());
        return response;
      }

      // SSR の loader/createServerFn が api-service をインプロセスで呼べるよう、
      // Hono RPC クライアントを AsyncLocalStorage で注入する（背景と設計意図は
      // shared/lib/api-client.ts を参照）。
      const response = await runWithApiClient(createInProcessApiClient(honoApp, requestId), () =>
        Promise.resolve(handler(request)),
      );
      waitUntil(cleanup());
      return withSecurityHeaders(response, isProd, requestId);
    } catch (e) {
      waitUntil(cleanup());
      // API 側の pino ログと突き合わせられるよう、requestId 付きの構造化ログで出力する
      console.error(
        JSON.stringify({
          level: "error",
          msg: "ssr unhandled error",
          requestId,
          err: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        }),
      );
      const body = isProd
        ? `Internal Server Error (requestId: ${requestId})`
        : `Error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`;
      return withSecurityHeaders(new Response(body, { status: 500 }), isProd, requestId);
    }
  },
};
