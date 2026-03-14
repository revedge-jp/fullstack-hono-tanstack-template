import { createFileRoute, redirect } from "@tanstack/react-router";
import { GoogleSignInButton, getSessionServerFn } from "@/features/auth";

export const Route = createFileRoute("/signin")({
  beforeLoad: async () => {
    const user = await getSessionServerFn();
    if (user) {
      throw redirect({ to: "/" });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-col items-center gap-6">
        <h1 className="font-bold text-2xl">meetform</h1>
        <GoogleSignInButton />
      </main>
    </div>
  );
}
