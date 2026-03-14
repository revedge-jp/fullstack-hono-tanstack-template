import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { SignOutButton } from "@/features/auth";

const authenticatedRoute = getRouteApi("/_authenticated");

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

function HomePage() {
  const { user } = authenticatedRoute.useLoaderData();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-col items-center gap-4">
        <h1 className="font-bold text-2xl">meetform</h1>
        <div className="flex flex-col items-center gap-1">
          <p className="font-medium">{user.name}</p>
          <p className="text-sm text-zinc-500">{user.email}</p>
        </div>
        <p className="text-zinc-500">Coming soon.</p>
        <Link to="/about" className="text-sm text-zinc-500 underline">
          about
        </Link>
        <SignOutButton />
      </main>
    </div>
  );
}
