import { createFileRoute, Link } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";
import { PageHeader } from "@/components/patterns/page-header";

export const Route = createFileRoute("/_authenticated/about")({
  head: () => ({ meta: [{ title: "about | {{APP_NAME}}" }] }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <CenteredPage>
      <main className="flex flex-col items-center gap-4">
        <PageHeader title="about" />
        <Link to="/" className="text-sm text-muted-foreground underline">
          ← home
        </Link>
      </main>
    </CenteredPage>
  );
}
