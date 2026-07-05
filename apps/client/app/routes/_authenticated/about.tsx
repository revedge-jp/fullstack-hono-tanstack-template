import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/about")({
  head: () => ({ meta: [{ title: "about | {{APP_NAME}}" }] }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-bold">about</h1>
        <Link to="/" className="text-sm text-zinc-500 underline">
          ← home
        </Link>
      </main>
    </div>
  );
}
