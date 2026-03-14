import { authClient } from "@/shared/lib/auth-client";

/**
 * Google OAuth でサインイン。
 * ブラウザ側でリダイレクトが発生するためクライアントコンポーネントから呼ぶ。
 */
export async function signInWithGoogle() {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL: `${window.location.origin}/`,
  });
  if (result.error) {
    throw new Error(result.error.message ?? "サインインに失敗しました");
  }
  return result;
}
