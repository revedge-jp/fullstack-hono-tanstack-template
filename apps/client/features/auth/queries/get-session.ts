import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getApiClient, type SessionUser } from "@/shared/lib/api-client";

// SSR でもブラウザ経路と同じ /api/me を通す（インプロセス RPC。api-client.ts 参照）。
export const getSessionServerFn = createServerFn().handler(
  async (): Promise<SessionUser | null> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await getApiClient(request).api.me.$get({}, { init: { headers: { cookie } } });
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
