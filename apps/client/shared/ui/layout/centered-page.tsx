import type { ReactNode } from "react";

// 画面中央に 1 カラムの内容を置くページ枠。背景色は body の bg-background に任せ、
// ここでは色を持たない（ページごとに背景を塗ると dark モードの対応を各所で手書きすることになる）。
export function CenteredPage(props: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center">{props.children}</div>;
}
