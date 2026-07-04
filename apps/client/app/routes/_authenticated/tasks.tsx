import { createFileRoute, Link } from "@tanstack/react-router";
import { CreateTaskForm, getTasksServerFn, TaskList } from "@/features/tasks";

export const Route = createFileRoute("/_authenticated/tasks")({
  loader: async () => {
    const tasks = await getTasksServerFn();
    return { tasks };
  },
  component: TasksPage,
});

function TasksPage() {
  const { tasks } = Route.useLoaderData();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-md flex-col gap-4 p-4">
        <h1 className="font-bold text-2xl">タスク</h1>
        <CreateTaskForm />
        <TaskList items={tasks.items} />
        <Link to="/" className="text-sm text-zinc-500 underline">
          ← home
        </Link>
      </main>
    </div>
  );
}
