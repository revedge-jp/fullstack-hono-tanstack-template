import { useState } from "react";

import { Button } from "@/components/ui/button";
import { reportHandledError } from "@/shared/lib/report-client-error";

import { signInErrorMessage, signInWithGoogle } from "../actions/sign-in";

export function GoogleSignInButton() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      // Better Auth のエラー文言（英語）や fetch の失敗（Failed to fetch）をそのまま画面に出さない。
      // 元のエラーは通報に残し、画面には次の操作が分かる文言を出す（sign-out-button.tsx と同じ形）
      reportHandledError(e, "signIn failed");
      setError(signInErrorMessage(e));
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={handleClick} variant="outline" disabled={isPending}>
        {isPending ? "リダイレクト中..." : "Google でサインイン"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
