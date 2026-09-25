import { createFileRoute, redirect } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";
import { PageHeader } from "@/components/patterns/page-header";
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
    <CenteredPage>
      <main className="flex flex-col items-center gap-6">
        <PageHeader title="{{APP_NAME}}" />
        <GoogleSignInButton />
        {import.meta.env.DEV && <DevSignInButton />}
      </main>
    </CenteredPage>
  );
}
