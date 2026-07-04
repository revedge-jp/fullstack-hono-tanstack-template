import { AsyncLocalStorage } from "node:async_hooks";
import type { createApp } from "api-service";

// server.ts の fetch ハンドラーが initHonoApp(env) で構築した container を
// AsyncLocalStorage 経由でサーバー関数に注入し、HTTP ラウンドトリップを回避する。
//
// 背景: CF Workers + Static Assets では、同一オリジンへの fetch() サブリクエストは
// Worker の fetch ハンドラーを経由せず 404 になる（ADR-001 参照）。この制約は
// セッション検証に限らず、SSR の loader/createServerFn から api-service の
// 任意の service を呼び出す場合すべてに当てはまる。container ごと ALS にスレッドすることで、
// 新しい feature を追加するたびに専用のチェッカー関数を作らずに済む。
export type ServerContainer = ReturnType<typeof createApp>["container"];

const storage = new AsyncLocalStorage<ServerContainer>();

export function runWithServerContainer<T>(
  container: ServerContainer,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(container, fn);
}

export function getServerContainer(): ServerContainer | undefined {
  return storage.getStore();
}
