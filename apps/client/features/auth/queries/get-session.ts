import { queryOptions } from "@tanstack/react-query";
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

// _authenticated の beforeLoad は全ナビゲーションで必ず実行される（未認証リダイレクトを全経路に
// 無条件で効かせるため。_authenticated.tsx 参照）。そこで getSessionServerFn を直接 await すると、
// 遷移のたびに /api/me への往復が発生する。queryClient 経由にして、beforeLoad 自体は毎回実行した
// まま、実際の取得だけを react-query の既定 staleTime（router.tsx、30 秒）でデデュープする。
// 呼ぶ側は fetchQuery を使う（ensureQueryData は古いキャッシュをそのまま返し、セッション切れを
// 見逃す。_authenticated.tsx 参照）。
// サインアウト時は queryClient.clear() でこのキャッシュも破棄される（sign-out-button.tsx）。
export function sessionQueryOptions() {
  return queryOptions({
    queryKey: ["session"],
    queryFn: () => getSessionServerFn(),
  });
}
