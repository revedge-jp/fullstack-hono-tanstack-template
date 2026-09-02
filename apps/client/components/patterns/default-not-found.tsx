import { NotFoundContent } from "@/components/patterns/not-found-content";

// **__root の notFoundComponent と router の defaultNotFoundComponent の両方に配線する。**
// notFound には2経路あり、片方だけでは穴が残る:
//   (a) loader の `throw notFound()` → boundary は常に __root(自前を持つため)
//   (b) URL がどのルートにもマッチしない → children を持つ最も深いマッチ済みルートが
//       描画位置になり、defaultNotFoundComponent が無いと組み込みの素の "Not Found" が出る
// 詳しい根拠は router.tsx のコメント参照。
//
// サイドバー等のレイアウトシェルを導入したら、認証済み配下ではシェルを保った表示に
// 分岐させる(本体は NotFoundContent を共有したまま、外枠だけ差し替える)。
export function DefaultNotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <NotFoundContent />
    </div>
  );
}
