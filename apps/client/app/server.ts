import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";

import { runWithSessionChecker } from "@/shared/lib/app-context";
import { initHonoApp } from "@/shared/lib/hono-app";
import { runWithServerContainer } from "@/shared/lib/server-container";

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

export default {
  async fetch(request: Request, env: CFBindings, ctx: CFContext) {
    // リクエストごとに新しい Hono アプリ（および postgres.js クライアント）を生成する。
    // ctx.waitUntil(cleanup()) はレスポンス送信後に DB 接続を解放し、
    // CF Workers のイベントループを完了させるために必要。
    // Vite 開発モードでは ctx が undefined のため、fire-and-forget にフォールバックする。
    const { app: honoApp, end, auth, container } = initHonoApp(env ?? {});
    const cleanup = () => end().catch(() => undefined);
    const waitUntil = (p: Promise<unknown>) => ctx?.waitUntil(p) ?? void p;

    try {
      const url = new URL(request.url);

      // /api/* は直接 Hono にディスパッチし、TanStack Start を完全にバイパスする。
      if (url.pathname.startsWith("/api/")) {
        const response = await honoApp.fetch(request);
        waitUntil(cleanup());
        return response;
      }

      // 初期化済みの auth インスタンスを使用するセッションチェッカーを構築する。
      // AsyncLocalStorage を通じてサーバー関数に注入することで、HTTP ループバックなしに
      // セッション検証が可能（CF Workers + Static Assets では HTTP ループバックは
      // 動作しないため — サブリクエストは Worker の fetch ハンドラーをバイパスする）。
      const checkSession = async (headers: Headers) => {
        const session = await auth.api.getSession({ headers });
        if (!session?.user) {
          return null;
        }
        return { id: session.user.id, email: session.user.email, name: session.user.name };
      };

      // container 自体も ALS にスレッドする。tasks 等、auth 以外の feature が SSR の
      // loader/createServerFn から api-service の service を HTTP ループバックなしに
      // 呼び出せるようにするため（同じ CF Workers 制約への一般化した対処。上記コメント参照）。
      const response = await runWithServerContainer(container, () =>
        runWithSessionChecker(checkSession, () => Promise.resolve(handler(request))),
      );
      waitUntil(cleanup());
      return response;
    } catch (e) {
      waitUntil(cleanup());
      console.error("[server] Error:", e);
      const isProd = env.NODE_ENV === "production";
      const body = isProd
        ? "Internal Server Error"
        : `Error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`;
      return new Response(body, { status: 500 });
    }
  },
};
