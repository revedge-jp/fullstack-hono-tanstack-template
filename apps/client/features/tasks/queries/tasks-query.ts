import { queryOptions } from "@tanstack/react-query";

import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

import { type TasksPage, TasksListResponseSchema } from "./schemas";

// タスク一覧の query 定義（queryKey と、ブラウザから取る queryFn）。
// loader は同じ queryKey に queryFn だけを getTasksServerFn に差し替えて ensureQueryData する（SSR ではブラウザ用の
// API クライアントが使えないため）。画面は useSuspenseQuery でこの定義を読み、古くなったときと mutation 後の
// invalidate では、ブラウザから同一オリジン API を直接取り直す。
// mutation 後に loader を再実行（router.invalidate）しない理由:
// クライアント遷移時の loader は serverFn の HTTP 呼び出しになり、
// ブラウザから同一オリジン API を直接叩くのに比べて一往復増えるだけで利点がない。
export function tasksQueryOptions(cursor?: string) {
  return queryOptions({
    queryKey: ["tasks", cursor ?? null] as const,
    retry: false,
    queryFn: async (): Promise<TasksPage> => {
      const res = await apiClient.api.tasks.$get({ query: cursor ? { cursor } : {} });
      if (!res.ok) {
        throw new Error("タスク一覧の取得に失敗しました");
      }
      const parsed = TasksListResponseSchema.safeParse(await res.json());
      if (!parsed.success || !parsed.data.ok) {
        throw new Error("タスク一覧のレスポンスが不正です");
      }
      return parsed.data.data;
    },
  });
}
