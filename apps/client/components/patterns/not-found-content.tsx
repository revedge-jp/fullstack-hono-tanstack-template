import { Link } from "@tanstack/react-router";

import { EmptyState } from "@/components/patterns/empty-state";
import { buttonVariants } from "@/components/ui/button";

// 「ページが見つかりませんでした」の本体。呼び出し元は default-not-found.tsx。
// __root.tsx はその DefaultNotFoundComponent を notFoundComponent に配線するだけで、
// この本体を直接描画しない。外側のセンタリングは呼び出し側に委ねる
// (ErrorFallbackContent と同じ流儀)。
export function NotFoundContent() {
  return (
    <EmptyState
      title="ページが見つかりませんでした"
      // 認可判定が確定していない一瞬の 403 等が「判定不能→無い扱い」でここに落ちる設計を
      // 採る場合、再読み込みで直るケースがあるため、断定を弱めて再読み込みの導線を置く。
      description="URLが間違っているか、ページが移動・削除された可能性があります。一時的に表示できない場合は、再読み込みで直ることがあります。"
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={buttonVariants({ variant: "outline" })}
          >
            再読み込み
          </button>
          <Link to="/" className={buttonVariants({ variant: "default" })}>
            ホームへ戻る
          </Link>
        </div>
      }
    />
  );
}
