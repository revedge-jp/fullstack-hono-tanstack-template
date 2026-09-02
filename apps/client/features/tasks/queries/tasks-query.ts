import { queryOptions } from "@tanstack/react-query";

import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

import { type TasksPage, TasksListResponseSchema } from "./schemas";

// クライアントサイドの再取得用 useQuery 定義。
// 初回表示は SSR（loader + getTasksServerFn）で行い、mutation 後の更新は
// この query の invalidate（ブラウザからの HTTP 再取得）で行う。
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
