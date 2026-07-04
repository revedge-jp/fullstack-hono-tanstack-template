import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { AppType } from "api-service";
import { hc } from "hono/client";
import { z } from "zod";
import { getServerContainer } from "@/shared/lib/server-container";

export type TaskItem = { id: string; title: string; status: string };

const TaskItemSchema = z.object({ id: z.string(), title: z.string(), status: z.string() });
const TasksListResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: z.object({ items: z.array(TaskItemSchema) }) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

// バックエンド障害を「タスク 0 件」と区別するため、取得失敗は throw して
// ルートの errorComponent（エラーバウンダリ）に委譲する。
// 未認証だけは空配列で返す（_authenticated ガードがリダイレクトを担うため、
// SSR 中の一瞬のセッション切れでエラーページを出さない）。
export const getTasksServerFn = createServerFn().handler(
  async (): Promise<{ items: TaskItem[] }> => {
    const request = getRequest();

    // CF Workers: container を直接呼び出す（HTTP ループバックなし）。
    // HTTP ループバックがこの環境で動作しない理由は shared/lib/server-container.ts を参照。
    const container = getServerContainer();
    if (container) {
      const session = await container.getSession(request);
      if (session.isErr()) {
        return { items: [] };
      }
      const result = await container.tasks.listTasks({ ownerId: session.value.id });
      if (result.isErr()) {
        throw new Error("タスク一覧の取得に失敗しました");
      }
      return {
        items: result.value.items.map((t: TaskItem) => ({
          id: t.id,
          title: t.title,
          status: t.status,
        })),
      };
    }

    // ローカル開発のフォールバック: /api/$ キャッチオールルートを経由した HTTP ループバックが使用可能。
    const cookie = request.headers.get("cookie") ?? "";
    const baseUrl = new URL(request.url).origin;
    const res = await hc<AppType>(baseUrl).api.tasks.$get({}, { init: { headers: { cookie } } });
    if (res.status === 401) {
      return { items: [] };
    }
    if (!res.ok) {
      throw new Error("タスク一覧の取得に失敗しました");
    }
    const parsed = TasksListResponseSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.ok) {
      throw new Error("タスク一覧のレスポンスが不正です");
    }
    return { items: parsed.data.data.items };
  },
);
