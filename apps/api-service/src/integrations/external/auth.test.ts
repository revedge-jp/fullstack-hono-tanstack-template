import { describe, expect, test } from "bun:test";

import { APIError } from "better-auth/api";

import { type AuthLogger, toBetterAuthLoggerOption } from "./auth";

type LoggedCall = { level: string; obj: unknown; msg: string | undefined };

function createCapturingLogger() {
  const calls: LoggedCall[] = [];
  const record =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      calls.push({ level, obj, msg });
    };
  const logger: AuthLogger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  return { logger, calls };
}

// pino は `err` 以外のキーを JSON.stringify で直列化する。Error インスタンスのままだと
// 直列化で message / stack が消えるので、出力相当の形で検証する。
function toLoggedJson(obj: unknown) {
  return JSON.parse(JSON.stringify(obj));
}

describe("toBetterAuthLoggerOption", () => {
  test("Error 引数は name / message / stack を保ったまま betterAuthArgs に入る", () => {
    const { logger, calls } = createCapturingLogger();
    const cause = new Error("No request state found.");

    toBetterAuthLoggerOption(logger).log(
      "error",
      "INTERNAL_SERVER_ERROR",
      new TypeError("boom", { cause }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe("error");
    expect(calls[0]?.msg).toBe("INTERNAL_SERVER_ERROR");
    const [serialized] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(serialized.name).toBe("TypeError");
    expect(serialized.message).toBe("boom");
    expect(serialized.stack).toContain("at ");
    expect(serialized.cause).toBe("Error: No request state found.");
  });

  test("Error 引数を err / error キーに載せない", () => {
    const { logger, calls } = createCapturingLogger();

    toBetterAuthLoggerOption(logger).log("warn", "something failed", new Error("boom"));

    const logged = toLoggedJson(calls[0]?.obj);
    expect(Object.keys(logged)).toEqual(["betterAuthArgs"]);
  });

  test("Error 以外の引数はそのまま渡す", () => {
    const { logger, calls } = createCapturingLogger();

    toBetterAuthLoggerOption(logger).log("warn", "hint", "text", { permissions: ["read"] });

    expect(calls[0]?.obj).toEqual({ betterAuthArgs: ["text", { permissions: ["read"] }] });
  });

  test("引数が無ければ空オブジェクトを渡す", () => {
    const { logger, calls } = createCapturingLogger();

    toBetterAuthLoggerOption(logger).log("warn", "no args");

    expect(calls[0]?.obj).toEqual({});
  });

  test("DrizzleQueryError 相当のバインド値はメッセージ・stack・cause のどこにも残さない", () => {
    const { logger, calls } = createCapturingLogger();
    const drizzleLikeError = Object.assign(
      new Error(
        'Failed query: select * from "user" where "email" = $1\nparams: secret@example.com',
      ),
      { query: 'select * from "user" where "email" = $1', params: ["secret@example.com"] },
    );
    const wrapped = new Error("adapter failed", { cause: drizzleLikeError });

    toBetterAuthLoggerOption(logger).log(
      "error",
      "INTERNAL_SERVER_ERROR",
      drizzleLikeError,
      wrapped,
    );

    const output = JSON.stringify(calls[0]?.obj);
    expect(output).not.toContain("secret@example.com");
    const [direct, withCause] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(direct.message).toBe('Failed query: select * from "user" where "email" = $1');
    expect(direct).not.toHaveProperty("params");
    expect(direct).not.toHaveProperty("query");
    expect(withCause.cause).toBe('Error: Failed query: select * from "user" where "email" = $1');
  });

  test("msg に渡されたメッセージからもバインド値を切り落とす", () => {
    const { logger, calls } = createCapturingLogger();

    toBetterAuthLoggerOption(logger).log(
      "error",
      'Failed query: select * from "user" where "email" = $1\nparams: secret@example.com',
    );

    expect(calls[0]?.msg).toBe('Failed query: select * from "user" where "email" = $1');
  });

  test("バインド値が改行と `at ` を含んでも stack に残さない", () => {
    const { logger, calls } = createCapturingLogger();
    const error = new Error(
      'Failed query: insert into "user" values ($1)\nparams: foo\n    at leaked-secret',
    );

    toBetterAuthLoggerOption(logger).log("error", "INTERNAL_SERVER_ERROR", error);

    const [serialized] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(JSON.stringify(serialized)).not.toContain("leaked-secret");
    expect(serialized.stack).toContain("at ");
  });

  test("stack 中にメッセージが見つからなければ stack を出さない", () => {
    const { logger, calls } = createCapturingLogger();
    const error = new Error("original");
    error.stack = "Error: rewritten\n    at leaked-secret";

    toBetterAuthLoggerOption(logger).log("warn", "hint", error);

    const [serialized] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(serialized).not.toHaveProperty("stack");
  });

  test("APIError は status / statusCode / body.code と errorStack のフレームを残す", () => {
    const { logger, calls } = createCapturingLogger();
    const error = new APIError("INTERNAL_SERVER_ERROR", {
      message: "Failed to create session",
      code: "FAILED_TO_CREATE_SESSION",
    });

    toBetterAuthLoggerOption(logger).log("error", "INTERNAL_SERVER_ERROR", error);

    const [serialized] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(serialized).toMatchObject({
      name: "APIError",
      message: "Failed to create session",
      status: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      bodyCode: "FAILED_TO_CREATE_SESSION",
    });
    expect(serialized.stack).toContain("at ");
  });

  test("SQLSTATE 22xxx のエラーはメッセージを出さずコードだけ残す", () => {
    const { logger, calls } = createCapturingLogger();
    const postgresError = Object.assign(
      new Error('invalid input syntax for type timestamp with time zone: "secret-ts-value"'),
      { name: "PostgresError", code: "22P02" },
    );
    const uniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "user_email_key"'),
      { name: "PostgresError", code: "23505", detail: "Key (email)=(secret@example.com)" },
    );

    toBetterAuthLoggerOption(logger).log(
      "error",
      "INTERNAL_SERVER_ERROR",
      postgresError,
      new Error("Failed query: update", { cause: postgresError }),
      new Error("Failed query: insert", { cause: uniqueViolation }),
    );

    const output = JSON.stringify(calls[0]?.obj);
    expect(output).not.toContain("secret-ts-value");
    expect(output).not.toContain("secret@example.com");
    const [direct, withDataException, withUniqueViolation] = toLoggedJson(
      calls[0]?.obj,
    ).betterAuthArgs;
    expect(direct).not.toHaveProperty("message");
    expect(direct.code).toBe("22P02");
    expect(withDataException.cause).toBe("PostgresError [22P02]");
    expect(withUniqueViolation.cause).toBe(
      'PostgresError [23505]: duplicate key value violates unique constraint "user_email_key"',
    );
  });

  test("message に Error が来ても throw せず、バインド値を msg にも betterAuthArgs にも残さない", () => {
    const { logger, calls } = createCapturingLogger();
    const drizzleLikeError = Object.assign(
      new Error('Failed query: select * from "session" where "user_id" = $1\nparams: user-123'),
      { query: 'select * from "session" where "user_id" = $1', params: ["user-123"] },
    );

    toBetterAuthLoggerOption(logger).log("error", drizzleLikeError, "extra");

    expect(calls[0]?.msg).toBe("Error");
    expect(JSON.stringify(calls[0])).not.toContain("user-123");
    const [serialized, extra] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(serialized.message).toBe('Failed query: select * from "session" where "user_id" = $1');
    expect(extra).toBe("extra");
  });

  test("message が文字列でも Error でもなければ msg は空で、値は betterAuthArgs に入る", () => {
    const { logger, calls } = createCapturingLogger();

    toBetterAuthLoggerOption(logger).log("warn", { reason: "unknown" });

    expect(calls[0]).toMatchObject({ msg: "", obj: { betterAuthArgs: [{ reason: "unknown" }] } });
  });

  test("メッセージがエラー名の一部と一致しても stack のフレームを残す", () => {
    const { logger, calls } = createCapturingLogger();

    toBetterAuthLoggerOption(logger).log("warn", "hint", new Error("Error"), new TypeError("Type"));

    const [error, typeError] = toLoggedJson(calls[0]?.obj).betterAuthArgs;
    expect(error.stack).toContain("at ");
    expect(error.stack).not.toContain("Error: Error");
    expect(typeError.stack).toContain("at ");
  });
});
