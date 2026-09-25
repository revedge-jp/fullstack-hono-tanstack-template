import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createAuth } from "@app/integrations/external/auth";
import { createDb } from "@repo/db";
import { createFakeApp } from "api-service/test-helpers";

import { createLoggerSpy } from "../../test-helpers/create-logger-spy";

// 到達不能なポートへ繋ぎ、Better Auth の DB アクセスを即座に ECONNREFUSED で失敗させる。
// drizzle はこれを DrizzleQueryError(メッセージに `\nparams: <バインド値>` を含む)で包む。
const { db, end } = createDb("postgres://user:pass@127.0.0.1:1/unreachable");

const ORIGIN = "http://localhost:3000";

function createRealAuth(logger: ReturnType<typeof createLoggerSpy>["logger"]) {
  const authLogger = {
    debug() {},
    info: (obj: unknown, msg?: string) => logger.info(obj, msg),
    warn: (obj: unknown, msg?: string) => logger.warn(obj, msg),
    error: (obj: unknown, msg?: string) => logger.error(obj, msg),
  };
  return createAuth(
    {
      secret: "c3VwZXItc2VjcmV0LXRlc3Qta2V5LWZvci1iZXR0ZXItYXV0aA",
      baseURL: ORIGIN,
      trustedOrigins: [ORIGIN],
      googleClientId: "test-client-id",
      googleClientSecret: "test-client-secret",
    },
    "test",
    db,
    authLogger,
  );
}

function signInSocial(provider: string) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ provider, callbackURL: "/" }),
  };
}

afterAll(async () => {
  await end();
});

describe("Better Auth のルーター例外 — onAPIError.throw で Hono の onError に渡す", () => {
  let consoleError: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleError = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test("DB 障害: better-call の console.error を通らず、onError の 500 JSON になる", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({
      nodeEnv: "production",
      logger: spy.logger,
      auth: createRealAuth(spy.logger),
    });

    const res = await app.request("/api/auth/sign-in/social", signInSocial("google"));

    expect(consoleError).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Internal Server Error", requestId: body.requestId });
    expect(body.requestId).toBeTruthy();
  });

  test("DB 障害: onError の err に SQL は残し、バインド値(codeVerifier 等)は載せない", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({
      nodeEnv: "production",
      logger: spy.logger,
      auth: createRealAuth(spy.logger),
    });

    await app.request("/api/auth/sign-in/social", signInSocial("google"));

    const unhandled = spy.error.filter(([, message]) => message === "unhandled error");
    expect(unhandled).toHaveLength(1);
    const logged = JSON.stringify(unhandled[0]?.[0]);
    expect(logged).toContain("Failed query: insert into");
    // メッセージは SQL 文だけなので、DB 停止かスキーマ不整合かは cause の code で見分ける
    expect(unhandled[0]?.[0]).toMatchObject({ causeCode: "ECONNREFUSED" });
    expect(logged).not.toContain("params:");
    expect(logged).not.toContain("codeVerifier");
    // Better Auth 内部のロガーが同じ例外を別のログに載せていないことも見る
    const everything = JSON.stringify([...spy.error, ...spy.warn, ...spy.info]);
    expect(everything).not.toContain("params:");
    expect(everything).not.toContain("codeVerifier");
  });

  test("development: レスポンスの detail(stack)からもバインド値を切り落とし、フレームは残す", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({
      nodeEnv: "development",
      logger: spy.logger,
      auth: createRealAuth(spy.logger),
    });

    const res = await app.request("/api/auth/sign-in/social", signInSocial("google"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toContain("Failed query: insert into");
    expect(body.detail).toContain("at ");
    expect(body.detail).not.toContain("params:");
    expect(body.detail).not.toContain("codeVerifier");
  });

  test("APIError(4xx)は従来どおり Better Auth のレスポンスを返し、onError へ届かない", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({
      nodeEnv: "production",
      logger: spy.logger,
      auth: createRealAuth(spy.logger),
    });

    const res = await app.request("/api/auth/sign-in/social", signInSocial("unknown-provider"));

    expect(consoleError).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("PROVIDER_NOT_FOUND");
    // Better Auth 自身もルート内で "Provider not found" を logger.error するので、件数ではなく
    // アプリ側(onError / 5xx ログ)のメッセージが出ていないことを見る。
    const appMessages = spy.error.map(([, message]) => message);
    expect(appMessages).not.toContain("unhandled error");
    expect(appMessages).not.toContain("better-auth server error");
  });
});

describe("/api/auth/* の 5xx レスポンス — APIError(500)もログに残す", () => {
  test("Better Auth が 5xx を返したら err 付きの error ログを出す", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({
      logger: spy.logger,
      auth: { handler: () => new Response(null, { status: 500 }) },
    });

    const res = await app.request("/api/auth/sign-in/social", { method: "POST" });

    expect(res.status).toBe(500);
    expect(spy.error).toEqual([
      [
        {
          method: "POST",
          path: "/api/auth/sign-in/social",
          status: 500,
          err: "Better Auth responded 500",
        },
        "better-auth server error",
      ],
    ]);
  });

  test("5xx 未満(499)では error ログを出さない", async () => {
    const spy = createLoggerSpy();
    const app = createFakeApp({
      logger: spy.logger,
      auth: { handler: () => new Response(null, { status: 499 }) },
    });

    await app.request("/api/auth/session");

    expect(spy.error).toHaveLength(0);
  });
});
