import { afterAll, describe, expect, test } from "bun:test";

import { createAuth, type Auth } from "@app/integrations/external/auth";
import { createDb } from "@repo/db";
import { APIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { DrizzleQueryError } from "drizzle-orm";

import { createLoggerSpy } from "../../../test-helpers/create-logger-spy";
import { makeVerifySession } from "./session";

const SESSION_TOKEN = "session-token-9f8e7d6c5b4a";
const SESSION_QUERY = 'select "id", "token" from "session" where "session"."token" = $1';
const SECRET = "c3VwZXItc2VjcmV0LXRlc3Qta2V5LWZvci1iZXR0ZXItYXV0aA";
const ORIGIN = "http://localhost:3000";

// 到達不能なポートへ繋ぎ、Better Auth の auth_sessions 参照を即座に ECONNREFUSED で失敗させる
const { db, end } = createDb("postgres://user:pass@127.0.0.1:1/unreachable");

afterAll(async () => {
  await end();
});

function createRejectingAuth(error: unknown): Auth {
  return { api: { getSession: () => Promise.reject(error) } } as unknown as Auth;
}

function verifyWith(error: unknown) {
  const spy = createLoggerSpy();
  const verifySession = makeVerifySession(createRejectingAuth(error), spy.logger);
  return { spy, result: verifySession(new Request(`${ORIGIN}/api/tasks`)) };
}

async function requestWithSessionCookie() {
  const signature = await makeSignature(SESSION_TOKEN, SECRET);
  const cookie = `better-auth.session_token=${encodeURIComponent(`${SESSION_TOKEN}.${signature}`)}`;
  return new Request(`${ORIGIN}/api/tasks`, { headers: { cookie } });
}

describe("makeVerifySession — getSession が reject したとき", () => {
  test("DB 障害(実経路): Better Auth が包み直した APIError の識別子を出し、トークンはどのログにも出ない", async () => {
    const spy = createLoggerSpy();
    const auth = createAuth(
      {
        secret: SECRET,
        baseURL: ORIGIN,
        trustedOrigins: [ORIGIN],
        googleClientId: "test-client-id",
        googleClientSecret: "test-client-secret",
      },
      "test",
      db,
      {
        debug() {},
        info: (obj: unknown, msg?: string) => spy.logger.info(obj, msg),
        warn: (obj: unknown, msg?: string) => spy.logger.warn(obj, msg),
        error: (obj: unknown, msg?: string) => spy.logger.error(obj, msg),
      },
    );

    const result = await makeVerifySession(auth, spy.logger)(await requestWithSessionCookie());

    expect(result._unsafeUnwrapErr()).toBe("Unexpected");
    const unexpected = spy.error.filter(
      ([, message]) => message === "verifySession unexpected error",
    );
    expect(unexpected).toEqual([
      [
        {
          err: "Failed to get session",
          causeCode: undefined,
          name: "APIError",
          apiStatus: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          bodyCode: "FAILED_TO_GET_SESSION",
        },
        "verifySession unexpected error",
      ],
    ]);
    // Better Auth の内蔵ロガーが記録する元の DrizzleQueryError も含めて見る
    expect(JSON.stringify([...spy.error, ...spy.warn, ...spy.info])).not.toContain(SESSION_TOKEN);
  });

  test("APIError(UNAUTHORIZED): 障害ではなく Unauthorized にし、error ログを出さない", async () => {
    const error = APIError.from("UNAUTHORIZED", {
      code: "FAILED_TO_GET_SESSION",
      message: "Failed to get session",
    });

    const { spy, result } = verifyWith(error);

    expect((await result)._unsafeUnwrapErr()).toBe("Unauthorized");
    expect(spy.error).toHaveLength(0);
  });

  test("DrizzleQueryError が包まれずに届いても: バインド値を載せず、SQL と cause の code だけを出す", async () => {
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
