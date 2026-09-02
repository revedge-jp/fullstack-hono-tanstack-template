import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

// 「問題が発生しました」表示の本体。全画面フォールバック(full-screen-error.tsx —
// __root.tsx と defaultErrorComponent が共有)が使う。外側のセンタリング/レイアウトの
// ラップは呼び出し側に委ねる — エラー文言を変えるときはここ1箇所を直せば全部に効く。
export function ErrorFallbackContent(props: { error: Error; description?: string }) {
  return (
    <>
      <EmptyState
        title="問題が発生しました"
        description={props.description ?? "時間をおいて再度お試しください。"}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={buttonVariants({ variant: "default" })}
            >
              再読み込み
            </button>
            <Link to="/" className={buttonVariants({ variant: "outline" })}>
              ホームへ戻る
            </Link>
          </div>
        }
      />
      {/* 生のエラーメッセージは内部情報を含みうるため開発時のみ表示する。
          サーバー側には requestId 付きの構造化ログが残る(app/server.ts / requestLogger) */}
      {import.meta.env.DEV ? (
        <p className="mt-2 text-center text-sm text-destructive opacity-70">
          {props.error.message}
        </p>
      ) : null}
    </>
  );
}
