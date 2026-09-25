// **SSR の serverFn で「未認証・判定不能」として扱うステータスの単一の定義。**
//
// SSR 初回取得の 401/403 は、エラー画面を出さずにフォールバック値（null / 空ページ等）を返し、
// リダイレクトは _authenticated の beforeLoad に任せる。401 だけを見るコピーが serverFn ごとに
// 増えると、403 を返す API（権限・所属の判定を足したとき）でエラー画面を出すラッパーが再生産される
// （派生プロダクトで実際に起きた）。判定はこの述語に寄せ、各 serverFn は
// フォールバック値だけを持つ。それ以外の非 2xx（500 等）はバックエンド障害なので throw する。
// 権限不足の 403 はガードがリダイレクトしないので空ページが黙って出る — apps/client/AGENTS.md の
// 「SSR の 401/403」。
export function isSsrAuthIndeterminate(status: number): boolean {
  return status === 401 || status === 403;
}
