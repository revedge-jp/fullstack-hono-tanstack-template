import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";

import appCss from "../globals.css?url";

type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    scripts: [
      // SSR インラインハイドレーションスクリプトで使用される esbuild ランタイムヘルパー。
      // TanStack Start がインラインスクリプトを注入する前にグローバルで定義する必要がある。
      {
        children:
          "var __name=(t,v)=>(Object.defineProperty(t,'name',{value:v,configurable:true}),t);",
      },
      // ダークモードの初期適用。head 内で first paint 前に実行し FOUC を防ぐ。
      // localStorage.theme（ThemeToggle が保存）→ なければ prefers-color-scheme の順で判定する。
      {
        children:
          "(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();",
      },
    ],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "{{APP_NAME}}" },
      {
        name: "description",
        content:
          "{{APP_NAME}} — Hono + TanStack Start で構築したフルスタックアプリのテンプレート。",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=LINESeedJP_OTF:wght@100;400;700&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
  errorComponent: ErrorComponent,
  notFoundComponent: NotFoundComponent,
  pendingComponent: PendingComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* theme-color は media クエリで light/dark を出し分ける。name が同じ meta は
            TanStack の HeadContent で重複排除され1つに畳まれるため、静的タグとして直接置く。 */}
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        {/* devtools は開発時のみ。本番バンドルからは import.meta.env.DEV の静的置換で除外される */}
        {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundComponent() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">404</h1>
      <p>ページが見つかりませんでした。</p>
    </div>
  );
}

function ErrorComponent({ error }: { error: Error }) {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-red-600">エラー</h1>
      <p>問題が発生しました。時間をおいて再度お試しください。</p>
      {/* 生のエラーメッセージは内部情報を含みうるため開発時のみ表示する。
          サーバー側には requestId 付きの構造化ログが残る（app/server.ts / requestLogger） */}
      {import.meta.env.DEV ? <p className="mt-2 text-sm opacity-70">{error.message}</p> : null}
    </div>
  );
}

function PendingComponent() {
  return (
    <div className="p-4">
      <p>読み込み中...</p>
    </div>
  );
}
