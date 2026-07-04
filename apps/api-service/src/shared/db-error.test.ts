import { describe, expect, test } from "bun:test";
import { isPgError } from "./db-error";

describe("isPgError", () => {
  test("トップレベルに code がある場合に一致する", () => {
    expect(isPgError({ code: "23505" }, "23505")).toBe(true);
  });

  test("drizzle-orm がラップした DrizzleQueryError（cause に PostgresError）でも一致する", () => {
    const wrapped = { query: "...", params: [], cause: { code: "23505" } };
    expect(isPgError(wrapped, "23505")).toBe(true);
  });

  test("コードが異なる場合は一致しない", () => {
    expect(isPgError({ code: "23503" }, "23505")).toBe(false);
  });

  test("code を持たないオブジェクト・null・undefined では false を返す", () => {
    expect(isPgError({}, "23505")).toBe(false);
    expect(isPgError(null, "23505")).toBe(false);
    expect(isPgError(undefined, "23505")).toBe(false);
  });
});
