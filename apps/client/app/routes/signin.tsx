import { createFileRoute, redirect } from "@tanstack/react-router";

import { DevSignInButton, GoogleSignInButton, getSessionServerFn } from "@/features/auth";

export const Route = createFileRoute("/signin")({
  head: () => ({ meta: [{ title: "サインイン | {{APP_NAME}}" }] }),
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
        <h1 className="text-2xl font-bold">{"{{APP_NAME}}"}</h1>
        <GoogleSignInButton />
        {import.meta.env.DEV && <DevSignInButton />}
      </main>
    </div>
  );
}
