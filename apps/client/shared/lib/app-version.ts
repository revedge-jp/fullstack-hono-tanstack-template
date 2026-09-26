// デプロイ後の古いタブ検知。API レスポンスの x-app-version ヘッダ(api-service の
// buildApp が全レスポンスに付与、値はデプロイ時の git SHA)を監視し、基準の値と異なる値を
// 検知したら=タブを開いている間にデプロイが起きたら、stale フラグを立てる。
// 基準は、このページの HTML を SSR が返した時点のバージョン(app/server.ts が Server-Timing で渡す)。
// 最初の API 応答を基準にすると、開いたまま放置している間にデプロイされたとき、最初の API 応答が
// もう新しい版なので検知できない。Server-Timing を読めないブラウザでは最初の API 応答を基準にする。タブを開きっぱなしにする運用では、古い JS のまま
// 送信し続ける事故が起きるための構造的対策。
//
// クライアント自身のビルドバージョンをバンドルに焼き込む方式にしない理由: この方式なら
// ビルド時環境変数の配線(turbo.json/CI/デプロイ)が一切不要で、SSR/dev("dev" 固定)でも
// 誤検知しない(値が変化しない限り stale にならない)。
let firstSeenVersion: string | null = null;
let stale = false;
const listeners = new Set<() => void>();

type ServerTimingEntry = { name: string; description: string };

function hasServerTiming(
  entry: PerformanceEntry,
): entry is PerformanceEntry & { serverTiming: readonly ServerTimingEntry[] } {
  return "serverTiming" in entry && Array.isArray(entry.serverTiming);
}

function readDocumentVersion(): string | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return null;
  }
  for (const entry of performance.getEntriesByType("navigation")) {
    if (!hasServerTiming(entry)) {
      continue;
    }
    const app = entry.serverTiming.find((timing) => timing.name === "app");
    if (app?.description) {
      return app.description;
    }
  }
  return null;
}

export function recordAppVersion(res: Response): void {
  const version = res.headers.get("x-app-version");
  if (!version) {
    return;
  }
  if (firstSeenVersion === null) {
    firstSeenVersion = readDocumentVersion() ?? version;
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

// このタブの基準のバージョン(SSR の Server-Timing、なければ最初の x-app-version)。
// クライアントエラー通報のタグ付けに使う。どちらもまだ無ければ null。
export function getObservedAppVersion(): string | null {
  return firstSeenVersion ?? readDocumentVersion();
}

// テスト間でモジュールスコープの状態をリセットするための補助(テスト専用)。
export function resetAppVersionForTest(): void {
  firstSeenVersion = null;
  stale = false;
  listeners.clear();
}
