import { AsyncLocalStorage } from "node:async_hooks";

// SSR の 1 リクエストごとの CSP nonce。server.ts が生成して CSP ヘッダーに入れ、同じ値を router の
// ssr.nonce（router.tsx）に渡す。TanStack Router は ssr.nonce を HeadContent / Scripts / ScriptOnce と
// ストリーミング中に差し込むスクリプトのすべてに付ける。
const storage = new AsyncLocalStorage<string>();

export function runWithCspNonce<T>(nonce: string, fn: () => T): T {
  return storage.run(nonce, fn);
}

export function getCspNonce(): string | undefined {
  return storage.getStore();
}

// 推測できない値にする（CSP3 は 128 bit 以上を推奨）
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
