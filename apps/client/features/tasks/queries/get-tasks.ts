import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { getApiClient } from "@/shared/lib/api-client";

export type TaskItem = { id: string; title: string; status: string };
export type TasksPage = { items: TaskItem[]; nextCursor: string | null };

const TaskItemSchema = z.object({ id: z.string(), title: z.string(), status: z.string() });
const TasksListResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.object({ items: z.array(TaskItemSchema), nextCursor: z.string().nullable() }),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

const GetTasksInputSchema = z.object({ cursor: z.string().optional() });

// SSR でもブラウザ経路と同じ /api/tasks を通す（インプロセス RPC。api-client.ts 参照）。
// バックエンド障害を「タスク 0 件」と区別するため、取得失敗は throw して
// ルートの errorComponent（エラーバウンダリ）に委譲する。
// 未認証だけは空ページで返す（_authenticated ガードがリダイレクトを担うため、
// SSR 中の一瞬のセッション切れでエラーページを出さない）。
export const getTasksServerFn = createServerFn()
  .validator(GetTasksInputSchema)
  .handler(async ({ data }): Promise<TasksPage> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await getApiClient().api.tasks.$get(
      { query: data.cursor ? { cursor: data.cursor } : {} },
      { init: { headers: { cookie } } },
    );
    if (res.status === 401) {
      return { items: [], nextCursor: null };
    }
    if (!res.ok) {
      throw new Error("タスク一覧の取得に失敗しました");
    }
    const parsed = TasksListResponseSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.ok) {
      throw new Error("タスク一覧のレスポンスが不正です");
    }
    return parsed.data.data;
  });
