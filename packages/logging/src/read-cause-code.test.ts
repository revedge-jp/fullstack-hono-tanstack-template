import { describe, expect, test } from "bun:test";

import { readCauseCode } from "./read-cause-code.js";

describe("readCauseCode", () => {
  test("cause の文字列 code を返す", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(readCauseCode(new Error("Failed query", { cause }))).toBe("ECONNREFUSED");
  });

  test("Error 以外は undefined", () => {
    expect(readCauseCode({ cause: { code: "ECONNREFUSED" } })).toBeUndefined();
  });

  test("cause が無い・null・オブジェクト以外なら undefined", () => {
    expect(readCauseCode(new Error("boom"))).toBeUndefined();
    expect(readCauseCode(new Error("boom", { cause: null }))).toBeUndefined();
    expect(readCauseCode(new Error("boom", { cause: "ECONNREFUSED" }))).toBeUndefined();
  });

  test("cause に code が無い・文字列でないなら undefined", () => {
    expect(readCauseCode(new Error("boom", { cause: new Error("inner") }))).toBeUndefined();
    expect(readCauseCode(new Error("boom", { cause: { code: 42 } }))).toBeUndefined();
  });
});
