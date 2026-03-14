"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "../actions/sign-in";

export function GoogleSignInButton() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "サインインに失敗しました");
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={handleClick} variant="outline" disabled={isPending}>
        {isPending ? "リダイレクト中..." : "Google でサインイン"}
      </Button>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </div>
  );
}
