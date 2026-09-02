// デプロイ後の古いタブ検知。API レスポンスの x-app-version ヘッダ(api-service の
// buildApp が全レスポンスに付与、値はデプロイ時の git SHA)を監視し、「このタブの JS が
// 読み込まれてから最初に見た値」と異なる値を検知したら=タブを開いている間にデプロイが
// 起きたら、stale フラグを立てる。タブを開きっぱなしにする運用では、古い JS のまま
// 送信し続ける事故が起きるための構造的対策。
//
// クライアント自身のビルドバージョンをバンドルに焼き込む方式にしない理由: この方式なら
// ビルド時環境変数の配線(turbo.json/CI/デプロイ)が一切不要で、SSR/dev("dev" 固定)でも
// 誤検知しない(値が変化しない限り stale にならない)。
let firstSeenVersion: string | null = null;
let stale = false;
const listeners = new Set<() => void>();

export function recordAppVersion(res: Response): void {
  const version = res.headers.get("x-app-version");
  if (!version) {
    return;
  }
  if (firstSeenVersion === null) {
    firstSeenVersion = version;
    return;
  }
  if (version !== firstSeenVersion && !stale) {
    stale = true;
    for (const listener of listeners) {
      listener();
    }
  }
}

export function subscribeStaleVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isStaleVersion(): boolean {
  return stale;
}

// このタブが最初に観測したアプリのバージョン(x-app-version 由来の git SHA)。
// クライアントエラー通報のタグ付けに使う。まだ API レスポンスを1件も見ていない
// (=どのエラーも発生し得ない早期)なら null。
export function getObservedAppVersion(): string | null {
  return firstSeenVersion;
}

// テスト間でモジュールスコープの状態をリセットするための補助(テスト専用)。
export function resetAppVersionForTest(): void {
  firstSeenVersion = null;
  stale = false;
  listeners.clear();
}
