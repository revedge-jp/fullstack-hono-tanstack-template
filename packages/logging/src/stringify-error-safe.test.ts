import { describe, expect, test } from "bun:test";

import { stringifyErrorSafe } from "./stringify-error-safe.js";

describe("stringifyErrorSafe", () => {
  test("Error は message を返す", () => {
    expect(stringifyErrorSafe(new Error("boom"))).toBe("boom");
  });

  test("JSON 化できるオブジェクトは JSON を返す", () => {
    expect(stringifyErrorSafe({ code: "E1" })).toBe('{"code":"E1"}');
  });

  test("循環参照は型名付きのプレースホルダになる", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(stringifyErrorSafe(value)).toBe("[unserializable Object]");
  });

  test("constructor を持たない循環オブジェクトは object として表す", () => {
    const value: Record<string, unknown> = Object.create(null);
    value.self = value;
    expect(stringifyErrorSafe(value)).toBe("[unserializable object]");
  });

  test("プロパティ参照が throw する Proxy でも例外を外に出さない", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(stringifyErrorSafe(hostile)).toBe("[unserializable object]");
  });

  test("プリミティブは String() 相当", () => {
    expect(stringifyErrorSafe("x")).toBe("x");
    expect(stringifyErrorSafe(42)).toBe("42");
    expect(stringifyErrorSafe(null)).toBe("null");
  });
});
