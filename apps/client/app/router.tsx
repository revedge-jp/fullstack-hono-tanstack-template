import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

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
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
