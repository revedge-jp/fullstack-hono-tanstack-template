import { createFileRoute } from "@tanstack/react-router";
import { getUsersQueryOptions } from "@/features/users";
import { Demo } from "@/widgets/demo";

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(getUsersQueryOptions()),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center bg-white px-16 py-32 sm:items-start dark:bg-black">
        <Demo className="mt-4" />
      </main>
    </div>
  );
}
