import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { CreateTaskForm, getTasksServerFn, TaskList } from "@/features/tasks";

// ページ位置を URL の search param（?cursor=...）で表現する。
// URL がページ状態の単一ソースになるため、SSR・リロード・共有・戻る操作すべてで位置が保たれる。
const TasksSearchSchema = z.object({
  cursor: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: TasksSearchSchema,
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: async ({ deps }) => {
    const tasks = await getTasksServerFn({ data: { cursor: deps.cursor } });
    return { tasks };
  },
  component: TasksPage,
});

function TasksPage() {
  const { tasks } = Route.useLoaderData();
  const { cursor } = Route.useSearch();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-md flex-col gap-4 p-4">
        <h1 className="font-bold text-2xl">タスク</h1>
        <CreateTaskForm />
        <TaskList items={tasks.items} />
        <div className="flex items-center justify-between">
          {cursor ? (
            <Link to="/tasks" className="text-sm text-zinc-500 underline">
              ← 最初のページ
            </Link>
          ) : (
            <span />
          )}
          {tasks.nextCursor && (
            <Link
              to="/tasks"
              search={{ cursor: tasks.nextCursor }}
              className="text-sm text-zinc-500 underline"
            >
              次のページ →
            </Link>
          )}
        </div>
        <Link to="/" className="text-sm text-zinc-500 underline">
          ← home
        </Link>
      </main>
    </div>
  );
}
