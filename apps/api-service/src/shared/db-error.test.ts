import { describe, expect, test } from "bun:test";

import { DrizzleQueryError } from "drizzle-orm";

import { createLoggerSpy } from "../test-helpers/create-logger-spy";
import { isPgError, toUnexpectedDbError } from "./db-error";

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

describe("toUnexpectedDbError", () => {
  function queryError(code: string) {
    const cause = Object.assign(new Error('relation "tasks" does not exist'), { code });
    return new DrizzleQueryError(
      'select "id" from "tasks" where "tasks"."owner_id" = $1',
      ["owner-secret-value"],
      cause,
    );
  }

  test("原因（SQLSTATE）と切り落としたメッセージを warn で残し、Unexpected を返す", () => {
    const spy = createLoggerSpy();

    const result = toUnexpectedDbError(spy.logger, "tasks.list")(queryError("42P01"));

    expect(result).toBe("Unexpected");
    expect(spy.warn).toHaveLength(1);
    const [payload, message] = spy.warn[0] ?? [];
    expect(message).toBe("db_query_failed");
    expect(payload).toMatchObject({ operation: "tasks.list", causeCode: "42P01" });
  });

  test("バインド値を出さず、Errors に数えられる error / err キーも使わない", () => {
    const spy = createLoggerSpy();

    toUnexpectedDbError(spy.logger, "tasks.list")(queryError("42P01"));

    expect(JSON.stringify(spy.warn)).not.toContain("owner-secret-value");
    expect(spy.error).toEqual([]);
    const [payload] = spy.warn[0] ?? [];
    expect(payload).not.toHaveProperty("err");
    expect(payload).not.toHaveProperty("error");
  });
});
