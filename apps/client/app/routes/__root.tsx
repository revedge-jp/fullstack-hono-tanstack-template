import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";

import { DefaultNotFoundComponent } from "@/components/patterns/default-not-found";
import { FullScreenError } from "@/components/patterns/full-screen-error";

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
  errorComponent: FullScreenError,
  // loader からの `throw notFound()` はここが受ける(getNotFoundBoundaryIndex は
  // 「notFoundComponent を持つ最も近い祖先(無ければ root)」を boundary に選び、子ルートは
  // 自前を持たないため常に __root になる)。**URL がどのルートにもマッチしない経路は別**で、
  // router.tsx の defaultNotFoundComponent が受ける — 両方に同じコンポーネントを配線する
  // 必要がある(詳しい根拠は router.tsx のコメント)。
  notFoundComponent: DefaultNotFoundComponent,
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

function PendingComponent() {
  return (
    <div className="p-4">
      <p>読み込み中...</p>
    </div>
  );
}
