import { AsyncLocalStorage } from "node:async_hooks";

// セッション検証後に必要な最小限のユーザー型。
export type SessionUser = { id: string; email: string; name: string };

// リクエストヘッダーを受け取り、認証済みユーザーを返す関数。
// セッションが存在しないか無効な場合は null を返す。
type CheckSessionFn = (headers: Headers) => Promise<SessionUser | null>;

// AsyncLocalStorage を使用してリクエストごとの CheckSessionFn をサーバー関数に注入し、
// HTTP ラウンドトリップを回避する。
//
// 背景: CF Workers + Static Assets では、同一オリジンへのサブリクエストは
// アセットハンドラー（Worker の fetch ハンドラーではなく）にルーティングされるため、
// fetch("/api/me") のような HTTP ループバック呼び出しは 404 を返す。
// AsyncLocalStorage はセッションチェッカーを同一リクエストコンテキスト内の
// 任意の非同期呼び出し元にインプロセスで提供することでこれを解決する。
const storage = new AsyncLocalStorage<CheckSessionFn>();

export function runWithSessionChecker<T>(
  checker: CheckSessionFn,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(checker, fn);
}

export function getSessionChecker(): CheckSessionFn | undefined {
  return storage.getStore();
}
