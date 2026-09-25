import { describe, expect, test } from "bun:test";

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
});
