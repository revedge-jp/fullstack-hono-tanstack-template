import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";

import { createInProcessApiClient, runWithApiClient } from "@/shared/lib/api-client";
import { initHonoApp } from "@/shared/lib/hono-app";
import { serverLogger } from "@/shared/lib/server-logger";

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
      serverLogger.error(
        {
          err: { name: reason.name, message: reason.message, stack: reason.stack },
          cause: "cause" in reason ? String(reason.cause) : undefined,
        },
        "unhandled rejection",
      );
    } else {
      serverLogger.error({ err: String(reason) }, "unhandled rejection (non-Error)");
    }
  });
}

type CFContext = { waitUntil: (p: Promise<unknown>) => void } | undefined;
type CFBindings = Record<string, string | { connectionString: string } | undefined>;

// SSR（非 /api/*）レスポンス用のセキュリティヘッダー。/api/* は Hono 側の secureHeaders() が担う。
// 静的アセット（CF assets バインディング直配信）には付かないが、CSP が意味を持つのは HTML なので十分。
export function withSecurityHeaders(
  response: Response,
  isProd: boolean,
  requestId?: string,
): Response {
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

    // リクエストごとに新しい Hono アプリ（および postgres.js クライアント）を生成する。
    // DB 接続の解放はレスポンスボディの完了後(releaseAfterResponse)。
    // ctx?.waitUntil ?? void p の分岐は、テストランナー等 fetch(request, env) の2引数のみで
    // 呼ばれる呼び出し元(ctx省略)向けのフォールバック。
    const { app: honoApp, end } = initHonoApp(env ?? {});
    const cleanup = () => end().catch(() => undefined);
    const waitUntil = (p: Promise<unknown>) => ctx?.waitUntil(p) ?? void p;
    const isProd = env?.NODE_ENV === "production";

    try {
      // /api/* は直接 Hono にディスパッチし、TanStack Start を完全にバイパスする。
      if (url.pathname.startsWith("/api/")) {
        const response = await honoApp.fetch(request);
        return releaseAfterResponse(response, cleanup, waitUntil);
      }

      // SSR の loader/createServerFn が api-service をインプロセスで呼べるよう、
      // Hono RPC クライアントを AsyncLocalStorage で注入する（背景と設計意図は
      // shared/lib/api-client.ts を参照）。
      const response = await runWithApiClient(createInProcessApiClient(honoApp, requestId), () =>
        Promise.resolve(handler(request)),
      );
      return releaseAfterResponse(
        withSecurityHeaders(response, isProd, requestId),
        cleanup,
        waitUntil,
      );
    } catch (e) {
      waitUntil(cleanup());
      // API 側の pino ログと突き合わせられるよう、requestId 付きの構造化ログで出力する
      serverLogger.error(
        {
          requestId,
          err: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        },
        "ssr unhandled error",
      );
      const body = isProd
        ? `Internal Server Error (requestId: ${requestId})`
        : `Error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`;
      return withSecurityHeaders(new Response(body, { status: 500 }), isProd, requestId);
    }
  },
};
