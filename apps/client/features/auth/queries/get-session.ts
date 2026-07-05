import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getApiClient, type SessionUser } from "@/shared/lib/api-client";

// SSR でもブラウザ経路と同じ /api/me を通す（インプロセス RPC。api-client.ts 参照）。
export const getSessionServerFn = createServerFn().handler(
  async (): Promise<SessionUser | null> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await getApiClient().api.me.$get({}, { init: { headers: { cookie } } });
    // 未認証（401/403）は「サインインしていない」= null として扱い、_authenticated
    // ガードのリダイレクトに委ねる。それ以外の非 2xx（500 等）はバックエンド障害なので
    // throw してルートの errorComponent に委譲する（未認証と混同してサインインへ飛ばさない）。
    if (res.status === 401 || res.status === 403) {
      return null;
    }
    if (!res.ok) {
      throw new Error("セッションの取得に失敗しました");
    }
    const json = await res.json();
    if (!json.ok) {
      return null;
    }
    const { id, email, name } = json.data;
    return { id, email, name };
  },
);
