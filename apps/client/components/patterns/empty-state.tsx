import type { ReactNode } from "react";

// 「まだ何も無い」画面のためのパターン。空 = 失敗ではなく次の行動への招待として扱う
// (空状態は行動への誘いであり、単なる不在の告知にしない)。
export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {props.icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {props.icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-base leading-normal font-medium">{props.title}</p>
        {props.description && <p className="text-sm text-muted-foreground">{props.description}</p>}
      </div>
      {props.action && <div className="mt-2">{props.action}</div>}
    </div>
  );
}
