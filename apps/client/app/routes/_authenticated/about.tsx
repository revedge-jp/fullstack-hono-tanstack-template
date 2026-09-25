import { createFileRoute, Link } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";

export const Route = createFileRoute("/_authenticated/about")({
  head: () => ({ meta: [{ title: "about | {{APP_NAME}}" }] }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <CenteredPage>
      <main className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-bold">about</h1>
        <Link to="/" className="text-sm text-muted-foreground underline">
          ← home
        </Link>
      </main>
    </CenteredPage>
  );
}
