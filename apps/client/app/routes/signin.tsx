import { createFileRoute, redirect } from "@tanstack/react-router";

import { CenteredPage } from "@/components/layout/centered-page";
import { PageHeader } from "@/components/patterns/page-header";
import { DevSignInButton, GoogleSignInButton, sessionQueryOptions } from "@/features/auth";

export const Route = createFileRoute("/signin")({
  head: () => ({ meta: [{ title: "サインイン | {{APP_NAME}}" }] }),
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
      {/* 塊は CenteredPage で中央に置き、中は左揃え（client.md「文章を中央揃えにしない」） */}
      <main className="flex w-full max-w-sm flex-col items-start gap-6 px-6">
        <PageHeader title="{{APP_NAME}}" />
        <GoogleSignInButton />
        {import.meta.env.DEV && <DevSignInButton />}
      </main>
    </CenteredPage>
  );
}
