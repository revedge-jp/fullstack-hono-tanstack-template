import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { DefaultNotFoundComponent } from "@/components/patterns/default-not-found";
import { FullScreenError } from "@/components/patterns/full-screen-error";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // SSR（loader / initialData）で取得済みのデータを、ハイドレーション直後に
        // 無条件で再フェッチしない（staleTime 0 だと mount 時に必ず background refetch が走る）。
        // mutation 後の更新は明示的な invalidateQueries で行う設計のため、これで無駄な
        // API + DB 往復だけが消える。
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    // 個別の errorComponent を持たないルートの SSR 初回描画失敗が英語の組み込み
    // フォールバック("Something went wrong!")に落ちないための共通フォールバック。
    // TanStack Router の Match は render の全経路で
    // `route.options.errorComponent ?? defaultErrorComponent` と解決するため、各 match が
    // 自分の位置でこれを描画する(祖先へのバブルには依存しない)。ルートごとに
    // errorComponent を書き足す方式は新規ルートでの書き忘れを防げないため、ここに一本化する。
    defaultErrorComponent: FullScreenError,
    // **notFound には2つの経路があり、両方に同じコンポーネントを配線する必要がある。**
    //
    //   (a) loader からの `throw notFound()`: getNotFoundBoundaryIndex が
    //       「notFoundComponent を持つ最も近い祖先(無ければ root)」を boundary に選ぶ。
    //       __root は自前を持つので boundary は常に __root → **こちらは __root 側が受ける**。
    //   (b) URL がどのルートにもマッチしない場合: findGlobalNotFoundRouteId が既定の
    //       fuzzy モードで「children を持つ最も深いマッチ済みルート」を選ぶ。それが
    //       notFoundComponent を持たないと、**defaultNotFoundComponent が無い限り
    //       TanStack 組み込みの素の `<p>Not Found</p>` が出る**。
    //
    // (a) は __root.tsx、(b) はここ、で同じ DefaultNotFoundComponent を指す。
    defaultNotFoundComponent: DefaultNotFoundComponent,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
