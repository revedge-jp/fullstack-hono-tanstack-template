import { ErrorFallbackContent } from "@/components/patterns/error-fallback-content";

// 全画面のエラーフォールバック。__root.tsx の errorComponent と
// router.tsx の defaultErrorComponent が共有する。
// レイアウトシェルより上位で描画されうるため、シェルの外でも成立する自前センタリングにする。
export function FullScreenError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <ErrorFallbackContent error={error} />
    </div>
  );
}
