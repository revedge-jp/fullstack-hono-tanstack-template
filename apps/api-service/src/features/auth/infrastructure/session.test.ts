import { describe, expect, test } from "bun:test";

import type { Auth } from "@app/integrations/external/auth";
import { DrizzleQueryError } from "drizzle-orm";

import { createLoggerSpy } from "../../../test-helpers/create-logger-spy";
import { makeVerifySession } from "./session";

const SESSION_TOKEN = "session-token-9f8e7d6c5b4a";
const SESSION_QUERY = 'select "id", "token" from "session" where "session"."token" = $1';

function createRejectingAuth(error: unknown): Auth {
  return { api: { getSession: () => Promise.reject(error) } } as unknown as Auth;
}

function verifyWith(error: unknown) {
  const spy = createLoggerSpy();
  const verifySession = makeVerifySession(createRejectingAuth(error), spy.logger);
  return { spy, result: verifySession(new Request("http://localhost/api/tasks")) };
}

describe("makeVerifySession — getSession が reject したとき", () => {
  test("DB 障害: バインド値(セッショントークン)をログに載せず、SQL と cause の code だけを出す", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const error = new DrizzleQueryError(SESSION_QUERY, [SESSION_TOKEN], cause);
    // 前提: DrizzleQueryError は message・stack・own プロパティ params のすべてにトークンを持つ
    expect(error.message).toContain(SESSION_TOKEN);
    expect(error.stack).toContain(SESSION_TOKEN);
    expect(error.params).toEqual([SESSION_TOKEN]);

    const { spy, result } = verifyWith(error);

    expect((await result)._unsafeUnwrapErr()).toBe("Unexpected");
    expect(spy.error).toEqual([
      [
        { err: `Failed query: ${SESSION_QUERY}`, causeCode: "ECONNREFUSED" },
        "verifySession unexpected error",
      ],
    ]);
    expect(JSON.stringify(spy.error)).not.toContain(SESSION_TOKEN);
  });

  test("cause の無い例外: message を err に出し、causeCode は undefined", async () => {
    const { spy, result } = verifyWith(new Error("boom"));

    expect((await result)._unsafeUnwrapErr()).toBe("Unexpected");
    expect(spy.error).toEqual([
      [{ err: "boom", causeCode: undefined }, "verifySession unexpected error"],
    ]);
  });
});
