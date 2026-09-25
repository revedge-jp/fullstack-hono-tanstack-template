import { createFileRoute, Outlet } from "@tanstack/react-router";

import { requireSessionUser } from "@/features/auth";

export const Route = createFileRoute("/_authenticated")({
  // 未認証リダイレクトは loader ではなく beforeLoad に置く。loader の結果は staleTime や
  // intent プリロード（router.tsx の defaultPreload、既定 30 秒）の間は再利用され、兄弟ルート間の
  // 遷移では再実行されない。loader に置くと、セッションが切れた後もその間の画面内遷移では
  // /signin へ送られず、画面は出たまま個々のデータ取得だけが 401 を返し続ける（移植元
  // revedge-jp/chiryonavi issue #341 で本番に出た）。beforeLoad は遷移のたびに必ず実行される。
  // 取得自体は sessionQueryOptions で 30 秒デデュープする（get-session.ts 参照）。
  //
  // **ensureQueryData ではなく fetchQuery を使う。** ensureQueryData はキャッシュがあれば古さに
  // 関係なくそれを返す（revalidateIfStale も裏で取り直すだけ）ので、セッションが切れた後も
  // キャッシュが gc されるまで（既定 5 分）ログイン済みとして素通りする。fetchQuery は staleTime を
  // 過ぎていれば取り直してから返すので、遅れは最大で staleTime（30 秒）に収まる（requireSessionUser と
  // そのテスト参照）。
  beforeLoad: async ({ context }) => ({ user: await requireSessionUser(context.queryClient) }),
  component: () => <Outlet />,
});
