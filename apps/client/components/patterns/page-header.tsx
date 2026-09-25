import type { ReactNode } from "react";

// ページの見出し（h1）を出す唯一の部品。見出しのサイズ・太さ・補足文・右側の操作の並びを
// ここに閉じ込め、ページごとに h1 の書き方がばらつくのを防ぐ（h1 の直書きはスタイルガードが禁止）。
export function PageHeader(props: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl leading-tight font-bold">{props.title}</h1>
        {props.description && <p className="text-sm text-muted-foreground">{props.description}</p>}
      </div>
      {props.action && (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{props.action}</div>
      )}
    </header>
  );
}
