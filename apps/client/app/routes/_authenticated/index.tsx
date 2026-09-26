import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { SignOutButton } from "@/features/auth";

const authenticatedRoute = getRouteApi("/_authenticated");

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "ホーム | {{APP_NAME}}" }] }),
  component: HomePage,
});

function HomePage() {
  const { user } = authenticatedRoute.useRouteContext();

  return (
    <CenteredPage>
      <main className="flex max-w-sm flex-col items-start gap-4 px-6">
        <PageHeader title="{{APP_NAME}}" />
        <div className="flex flex-col items-start gap-1">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-sm wrap-anywhere text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-3">
          <Link to="/tasks" className="text-sm text-muted-foreground underline">
            タスク
          </Link>
          <Link to="/about" className="text-sm text-muted-foreground underline">
            このアプリについて
          </Link>
        </div>
        <div className="flex items-start gap-3">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </main>
    </CenteredPage>
  );
}
