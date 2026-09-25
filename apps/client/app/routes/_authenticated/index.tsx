import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";
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
    <CenteredPage>
      <main className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-bold">{"{{APP_NAME}}"}</h1>
        <div className="flex flex-col items-center gap-1">
          <p className="font-medium">{user.name}</p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <p className="text-muted-foreground">Coming soon.</p>
        <div className="flex gap-3">
          <Link to="/tasks" className="text-sm text-muted-foreground underline">
            tasks
          </Link>
          <Link to="/about" className="text-sm text-muted-foreground underline">
            about
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </main>
    </CenteredPage>
  );
}
