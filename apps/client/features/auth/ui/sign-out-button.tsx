"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { signOut } from "../actions/sign-out";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    try {
      await signOut();
    } catch (e) {
      // サインアウト失敗時もナビゲートする（セッションは期限切れで自然に無効化）
      console.error("signOut failed:", e);
    }
    // サインアウトしたユーザーにひも付く react-query キャッシュ（tasks 等）を破棄し、
    // 次のユーザーに前ユーザーのデータが残らないようにする。
    queryClient.clear();
    void router.navigate({ to: "/signin" });
  }

  return (
    <Button onClick={handleSignOut} variant="outline">
      サインアウト
    </Button>
  );
}
