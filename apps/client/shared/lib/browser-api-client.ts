import type { AppType } from "api-service";
import { hc } from "hono/client";

import { recordAppVersion } from "./app-version";

// ブラウザから同一オリジン API を直接呼ぶ mutation(actions/*.ts)共通の Hono RPC クライアント。
// CF Workers では自オリジンへの HTTP ループバックが不可なため、mutation は必ずブラウザ発とする
// (ADR-001)。すべての action ファイルで同一インスタンスを使い回す。
// fetch をラップし、レスポンスの x-app-version ヘッダからデプロイまたぎの古いタブを
// 検知する(shared/lib/app-version.ts)。
export const browserApiClient = hc<AppType>("/", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init).then((res) => {
      recordAppVersion(res);
      return res;
    }),
});
