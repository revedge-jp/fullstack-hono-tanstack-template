import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { CenteredPage } from "@/components/layout/centered-page";
import { PageHeader } from "@/components/patterns/page-header";
import { CreateTaskForm, getTasksServerFn, TaskList, tasksQueryOptions } from "@/features/tasks";

// ページ位置を URL の search param（?cursor=...）で表現する。
// URL がページ状態の単一ソースになるため、SSR・リロード・共有・戻る操作すべてで位置が保たれる。
const TasksSearchSchema = z.object({
  cursor: z.string().optional(),
});

// データ取得の役割分担（apps/client/AGENTS.md の「Data fetching: SSR vs client-side」パターン）:
// - loader: queryClient.ensureQueryData で、キャッシュが無いときだけサーバー関数で取る（SSR とクライアント遷移の初回）。
//   SSR ではブラウザ用の API クライアントが使えないので、queryFn だけを getTasksServerFn に差し替える
// - 画面: 同じ queryKey を useSuspenseQuery で読む（loader が入れたキャッシュをそのまま使い、古ければブラウザから取り直す）
// - mutation 後の更新: tasksQueryOptions の invalidate によるブラウザからの再取得
// loader の戻り値を useQuery の初期値として渡す形にしない。キャッシュが既にあるとその初期値は使われず、
// loader が取ったデータを捨てて古いキャッシュを出す（apps/client/AGENTS.md の「Data fetching」）
export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "タスク｜{{APP_NAME}}" }] }),
  validateSearch: TasksSearchSchema,
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData({
      ...tasksQueryOptions(deps.cursor),
      queryFn: () => getTasksServerFn({ data: { cursor: deps.cursor } }),
    }),
  component: TasksPage,
});

function TasksPage() {
  const { cursor } = Route.useSearch();
  const { data: tasks } = useSuspenseQuery(tasksQueryOptions(cursor));

  return (
    <CenteredPage>
      <main className="flex w-full max-w-md flex-col gap-4 p-4">
        <PageHeader title="タスク" />
        <CreateTaskForm />
        <TaskList items={tasks.items} />
        <div className="flex items-center justify-between">
          {cursor ? (
            <Link to="/tasks" className="text-sm text-muted-foreground underline">
              ← 最初のページ
            </Link>
          ) : (
            <span />
          )}
          {tasks.nextCursor && (
            <Link
              to="/tasks"
              search={{ cursor: tasks.nextCursor }}
              className="text-sm text-muted-foreground underline"
            >
              次のページ →
            </Link>
          )}
        </div>
        <Link to="/" className="text-sm text-muted-foreground underline">
          ← ホーム
        </Link>
      </main>
    </CenteredPage>
  );
}
