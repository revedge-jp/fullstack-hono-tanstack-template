import { authClient } from "@/shared/lib/auth-client";

/**
 * サインアウト。Better Auth のクライアントは HTTP エラーを throw せず `{ error }` で返すので、
 * ここで例外にする（見ないと、サーバーが失敗してもセッションが残ったまま成功扱いになる）。
 */
export async function signOut() {
  const result = await authClient.signOut();
  if (result.error) {
    throw new Error(result.error.message ?? "サインアウトに失敗しました");
  }
  return result;
}
