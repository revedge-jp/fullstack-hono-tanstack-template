import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SignOutButton } from "@/features/auth";

const authenticatedRoute = getRouteApi("/_authenticated");

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "ホーム | {{APP_NAME}}" }] }),
  component: HomePage,
});

function HomePage() {
  const { user } = authenticatedRoute.useLoaderData();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-bold">{"{{APP_NAME}}"}</h1>
        <div className="flex flex-col items-center gap-1">
          <p className="font-medium">{user.name}</p>
          <p className="text-sm text-zinc-500">{user.email}</p>
        </div>
        <p className="text-zinc-500">Coming soon.</p>
        <div className="flex gap-3">
          <Link to="/tasks" className="text-sm text-zinc-500 underline">
            tasks
          </Link>
          <Link to="/about" className="text-sm text-zinc-500 underline">
            about
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </main>
    </div>
  );
}
