import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { reportHandledError } from "@/shared/lib/report-client-error";

import { signOut } from "../actions/sign-out";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setIsPending(true);
    setError(null);
    try {
      await signOut();
    } catch (e) {
      // 失敗したらセッションはまだ有効なので、/signin へ送っても beforeLoad がホームへ戻すだけで
      // 「押したのにログインしたまま」に見える。遷移せずにその場で知らせる
      reportHandledError(e, "signOut failed");
      setError("サインアウトに失敗しました。時間をおいて再度お試しください");
      setIsPending(false);
      return;
    }
    // サインアウトしたユーザーにひも付く react-query キャッシュ（tasks 等）を破棄し、
    // 次のユーザーに前ユーザーのデータが残らないようにする。
    queryClient.clear();
    void router.navigate({ to: "/signin" });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={handleSignOut} variant="outline" disabled={isPending}>
        サインアウト
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
