import { createFileRoute, redirect } from "@tanstack/react-router";

import { DevSignInButton, GoogleSignInButton, sessionQueryOptions } from "@/features/auth";
import { CenteredPage } from "@/shared/ui/layout";
import { PageHeader } from "@/shared/ui/patterns";

export const Route = createFileRoute("/signin")({
  head: () => ({ meta: [{ title: "サインイン｜{{APP_NAME}}" }] }),
  // _authenticated と同じキャッシュを fetchQuery で見る（サインアウト時は queryClient.clear() で破棄され、
  // サインインは OAuth / dev ログインともページ全体の遷移なので、古い「未ログイン」は残らない）
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.fetchQuery(sessionQueryOptions());
    if (user) {
      throw redirect({ to: "/" });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  return (
    <CenteredPage>
      <main className="flex max-w-sm flex-col items-start gap-6 px-6">
        <PageHeader title="{{APP_NAME}}" />
        <GoogleSignInButton />
        {import.meta.env.DEV && <DevSignInButton />}
      </main>
    </CenteredPage>
  );
}
