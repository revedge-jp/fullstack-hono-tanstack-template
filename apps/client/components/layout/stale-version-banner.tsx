import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { isStaleVersion, subscribeStaleVersion } from "@/shared/lib/app-version";

// デプロイ後の古いタブ検知バナー。API レスポンスのバージョン変化を検知したら
// (shared/lib/app-version.ts)、再読み込みを促す。自動リロードにしない理由: フォームの
// 入力途中など、ユーザーが未保存の作業を持っている可能性があるため、リロードのタイミングは
// ユーザーに委ねる。SSR ではサーバースナップショット(false)で常に非表示となり、
// ハイドレーション不一致は起きない。
export function StaleVersionBanner() {
  const stale = useSyncExternalStore(subscribeStaleVersion, isStaleVersion, () => false);
  if (!stale) {
    return null;
  }
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm text-foreground print:hidden"
    >
      <span>アプリが更新されました。再読み込みして最新の状態でご利用ください。</span>
      <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
        再読み込み
      </Button>
    </div>
  );
}
