import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";
import { PageHeader } from "@/components/patterns/page-header";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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
      {/* 塊は CenteredPage で中央に置き、中は左揃え（client.md「文章を中央揃えにしない」） */}
      <main className="flex w-full max-w-sm flex-col items-start gap-4 px-6">
        <PageHeader title="{{APP_NAME}}" />
        <div className="flex flex-col items-start gap-1">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <p className="text-sm text-muted-foreground">Coming soon.</p>
        <div className="flex gap-3">
          <Link to="/tasks" className="text-sm text-muted-foreground underline">
            tasks
          </Link>
          <Link to="/about" className="text-sm text-muted-foreground underline">
            about
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
