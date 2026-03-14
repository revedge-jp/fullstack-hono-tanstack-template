import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { AppType } from "api-service";
import { hc } from "hono/client";
import { getSessionChecker, type SessionUser } from "@/shared/lib/app-context";

export const getSessionServerFn = createServerFn().handler(
  async (): Promise<SessionUser | null> => {
    const request = getRequest();

    // CF Workers: セッションチェッカーを直接呼び出す（HTTP ループバックなし）。
    // HTTP ループバックがこの環境で動作しない理由は app-context.ts を参照。
    const checker = getSessionChecker();
    if (checker) {
      return checker(request.headers);
    }

    // ローカル開発のフォールバック: /api/$ キャッチオールルートを経由した HTTP ループバックが使用可能。
    const cookie = request.headers.get("cookie") ?? "";
    const baseUrl = new URL(request.url).origin;
    const res = await hc<AppType>(baseUrl).api.me.$get({}, { init: { headers: { cookie } } });
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    if (!json.ok) {
      return null;
    }
    const { id, email, name } = json.data;
    return { id, email, name };
  },
);
