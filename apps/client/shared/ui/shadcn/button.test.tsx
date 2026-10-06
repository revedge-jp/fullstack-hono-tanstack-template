import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./button";

// 主要ボタンの hover は shadcn の生成物を書き換えている（ADR-008）。再生成で戻ったら落ちるように固定する。
describe("Button の default", () => {
  test("hover は primary を薄くせず、暗くした primary-hover で描く", () => {
    const html = renderToStaticMarkup(<Button>保存</Button>);

    expect(html).toContain("hover:bg-primary-hover");
    expect(html).not.toContain("hover:bg-primary/80");
  });
});
