import { createFileRoute, Link } from "@tanstack/react-router";

import { CenteredPage } from "@/shared/ui/layout";
import { PageHeader } from "@/shared/ui/patterns";

export const Route = createFileRoute("/_authenticated/about")({
  head: () => ({ meta: [{ title: "このアプリについて｜{{APP_NAME}}" }] }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <CenteredPage>
      <main className="flex max-w-sm flex-col items-start gap-4 px-6">
        <PageHeader title="このアプリについて" />
        <Link to="/" className="text-sm text-muted-foreground underline">
          ← ホーム
        </Link>
      </main>
    </CenteredPage>
  );
}
