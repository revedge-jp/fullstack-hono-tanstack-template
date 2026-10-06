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
    // 塊は中央、文字は左(client.md「文章を中央揃えにしない」)。内側を内容幅に縮めるので、
    // 短い 1 行でも塊ごと中央に見える。
    <div className="flex justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-start gap-5">
        <div className="flex flex-col items-start gap-3">
          {props.icon && (
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {props.icon}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-base leading-normal font-medium">{props.title}</p>
            {props.description && (
              <p className="text-sm text-muted-foreground">{props.description}</p>
            )}
          </div>
        </div>
        {props.action}
      </div>
    </div>
  );
}
