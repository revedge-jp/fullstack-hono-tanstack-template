import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getApiClient, type SessionUser } from "@/shared/lib/api-client";
import { isSsrAuthIndeterminate } from "@/shared/lib/ssr-auth";

// SSR でもブラウザ経路と同じ /api/me を通す（インプロセス RPC。api-client.ts 参照）。
export const getSessionServerFn = createServerFn().handler(
  async (): Promise<SessionUser | null> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await getApiClient().api.me.$get({}, { init: { headers: { cookie } } });
    // 未認証（401/403）は「サインインしていない」= null として扱い、_authenticated
    // ガードのリダイレクトに委ねる。それ以外の非 2xx（500 等）はバックエンド障害なので
    // throw してルートの errorComponent に委譲する（未認証と混同してサインインへ飛ばさない）。
    if (isSsrAuthIndeterminate(res.status)) {
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

// _authenticated の beforeLoad は全ナビゲーションで実行されるので、/api/me への往復を queryClient
// 経由で SESSION_STALE_TIME_MS だけデデュープする（認証ガードの全体像は apps/client/AGENTS.md の
// 「Auth pattern」）。staleTime を全体の既定に頼らず明示するのは、既定が変わると「セッション切れを
// 何秒で検出するか」まで黙って変わるため。
const SESSION_STALE_TIME_MS = 30_000;

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: ["session"],
    queryFn: () => getSessionServerFn(),
    staleTime: SESSION_STALE_TIME_MS,
  });
}

// _authenticated の beforeLoad が使うガード本体。未ログインなら /signin へ redirect を throw する。
// fetchQuery を使うこと（ensureQueryData は古いキャッシュをそのまま返し、セッション切れを gc まで
// 見逃す）。この性質は get-session.test.ts が時刻を進めて確かめている。
export async function requireSessionUser(queryClient: QueryClient): Promise<SessionUser> {
  const user = await queryClient.fetchQuery(sessionQueryOptions());
  if (!user) {
    throw redirect({ to: "/signin" });
  }
  return user;
}
