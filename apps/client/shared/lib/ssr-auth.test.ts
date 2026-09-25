import { describe, expect, test } from "bun:test";

import { isSsrAuthIndeterminate } from "./ssr-auth";

describe("isSsrAuthIndeterminate", () => {
  test.each([401, 403])("%d は未認証・判定不能として扱う", (status) => {
    expect(isSsrAuthIndeterminate(status)).toBe(true);
  });

  test.each([200, 400, 404, 409, 500, 503])(
    "%d は扱わない（成功・業務エラー・障害は呼び出し側が判断する）",
    (status) => {
      expect(isSsrAuthIndeterminate(status)).toBe(false);
    },
  );
});
