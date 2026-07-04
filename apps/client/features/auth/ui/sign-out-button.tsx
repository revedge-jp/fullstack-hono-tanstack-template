"use client";

import { useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { signOut } from "../actions/sign-out";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    try {
      await signOut();
    } catch (e) {
      // サインアウト失敗時もナビゲートする（セッションは期限切れで自然に無効化）
      console.error("signOut failed:", e);
    }
    router.navigate({ to: "/signin" });
  }

  return (
    <Button onClick={handleSignOut} variant="outline">
      サインアウト
    </Button>
  );
}
