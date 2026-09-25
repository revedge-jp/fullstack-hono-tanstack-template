// **SSR の serverFn で「未認証・判定不能」として扱うステータスの単一の定義。**
//
// SSR 初回取得の 401/403 は、エラー画面を出さずにフォールバック値（null / 空ページ等）を返し、
// リダイレクトは _authenticated の beforeLoad に任せる。401 だけを見るコピーが serverFn ごとに
// 増えると、403 を返す API（権限・所属の判定を足したとき）でエラー画面を出すラッパーが再生産される
// （移植元 revedge-jp/chiryonavi issue #854 の原因）。判定はこの述語に寄せ、各 serverFn は
// フォールバック値だけを持つ。それ以外の非 2xx（500 等）はバックエンド障害なので throw する。
//
// **限界: 403 の「リダイレクトはガードに任せる」は、セッションが原因の 403 にしか効かない。**
// _authenticated のガードはセッション（/api/me）しか見ないので、ログイン済みユーザーへの権限不足の
// 403 ではリダイレクトされず、フォールバック値（空ページ等）が黙って出る。権限不足を画面で伝える
// 必要がある serverFn は、この述語より先に 403 を別に扱う（専用の表示・throw 等）。今の api-service は
// 403 を返さない。
export function isSsrAuthIndeterminate(status: number): boolean {
  return status === 401 || status === 403;
}
