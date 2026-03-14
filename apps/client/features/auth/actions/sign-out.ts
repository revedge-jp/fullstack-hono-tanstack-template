import { authClient } from "@/shared/lib/auth-client";

/**
 * サインアウト。
 */
export async function signOut() {
  return authClient.signOut();
}
