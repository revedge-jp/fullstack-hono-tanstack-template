import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  ScriptOnce,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";

import { StaleVersionBanner } from "@/shared/ui/layout";
import { DefaultNotFoundComponent } from "@/shared/ui/patterns";
import { FullScreenError } from "@/shared/ui/patterns";

import appCss from "../globals.css?url";

type RouterContext = {
  queryClient: QueryClient;
};

// head のインラインスクリプトは ScriptOnce で出す（サーバーでだけ描画され、実行後に自分を消す）。head.scripts に
// 置くと、CSP の nonce をヘッダーで送ったときにブラウザが nonce 属性を隠すので、TanStack Router がハイドレーション後に
// 「同じスクリプトがまだ無い」と判断してもう一度差し込み、2 回実行する。
// 1) SSR インラインハイドレーションスクリプトで使用される esbuild ランタイムヘルパー。
//    TanStack Start がインラインスクリプトを注入する前にグローバルで定義する必要がある。
const DEFINE_NAME_HELPER =
  "var __name=(t,v)=>(Object.defineProperty(t,'name',{value:v,configurable:true}),t);";
// 2) ダークモードの初期適用。head 内で first paint 前に実行し FOUC を防ぐ。
//    localStorage.theme（ThemeToggle が保存）→ なければ prefers-color-scheme の順で判定する。
const APPLY_INITIAL_THEME =
  "(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "{{APP_NAME}}" },
      {
        name: "description",
        content: "{{APP_NAME}}はHono + TanStack Startで構築したフルスタックアプリです。",
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
        href: "https://fonts.googleapis.com/css2?family=LINE+Seed+JP:wght@400;700&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  // <html> は shellComponent で描く。component（エラー境界の内側）で描くと、root でエラーが起きたときに errorComponent が
  // <html> の外に出て、CSS もハイドレーションも無い画面になる（@tanstack/react-router の Match は root の shellComponent だけを
  // エラー境界の外に置く）。component を省くと root は <Outlet /> を描く
  shellComponent: RootDocument,
  errorComponent: FullScreenError,
  // loader からの `throw notFound()` はここが受ける(getNotFoundBoundaryIndex は
  // 「notFoundComponent を持つ最も近い祖先(無ければ root)」を boundary に選び、子ルートは
  // 自前を持たないため常に __root になる)。**URL がどのルートにもマッチしない経路は別**で、
  // router.tsx の defaultNotFoundComponent が受ける — 両方に同じコンポーネントを配線する
  // 必要がある(詳しい根拠は router.tsx のコメント)。
  notFoundComponent: DefaultNotFoundComponent,
  pendingComponent: PendingComponent,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* theme-color は media クエリで light/dark を出し分ける。name が同じ meta は
            TanStack の HeadContent で重複排除され1つに畳まれるため、静的タグとして直接置く。
            値は globals.css の --background（:root / .dark）を 16 進にしたもの。配色を変えたら揃える */}
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#171613" media="(prefers-color-scheme: dark)" />
        <ScriptOnce>{DEFINE_NAME_HELPER}</ScriptOnce>
        <ScriptOnce>{APPLY_INITIAL_THEME}</ScriptOnce>
        <HeadContent />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <StaleVersionBanner />
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
      <p className="text-sm text-muted-foreground">読み込み中…</p>
    </div>
  );
}
