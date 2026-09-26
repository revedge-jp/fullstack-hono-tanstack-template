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
    // 画面の文言を status で分けられるよう、Better Auth の status を Error に載せる（signInErrorMessage）
    throw Object.assign(new Error(result.error.message ?? "サインインに失敗しました"), {
      status: result.error.status,
    });
  }
  return result;
}

// サインインを始められなかったときに画面に出す文言。Better Auth のエラー文言（英語）はそのまま出さない。
// 429 に「もう一度」と案内すると押し直してまた 429 になるので、actions の共通文言（shared/lib/action-error.ts）と
// 同じ分け方にする
export function signInErrorMessage(error: unknown): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  if (status === undefined) {
    return "通信に失敗しました。接続を確認して再度お試しください";
  }
  if (status === 429) {
    return "操作が集中しています。しばらく待ってから再度お試しください";
  }
  if (status >= 500) {
    return "サーバーでエラーが発生しました。時間をおいて再度お試しください";
  }
  return "サインインを開始できませんでした。ページを再読み込みして、もう一度お試しください";
}
