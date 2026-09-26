import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockSocialSignIn = mock(() => Promise.resolve({ data: null, error: null }));

await mock.module("@/shared/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: mockSocialSignIn,
    },
  },
}));

const { signInErrorMessage, signInWithGoogle } = await import("./sign-in");

describe("auth.signInWithGoogle", () => {
  // window.location.origin が必要。テストごとに定義して消す — モジュールのトップで
  // configurable なしに定義すると、同一プロセスで後に走るファイルが window を差し替えられない。
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "http://localhost", pathname: "/signin" } },
    });
  });

  afterEach(() => {
    // @ts-expect-error テスト後片付け
    delete globalThis.window;
  });

  test("Google OAuth を provider=google で呼び出す", async () => {
    await signInWithGoogle();
    expect(mockSocialSignIn).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "http://localhost/",
    });
  });

  test("異常: error が返った場合は例外を投げる", async () => {
    mockSocialSignIn.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "OAuth error" } } as unknown as {
        data: null;
        error: null;
      }),
    );
    await expect(signInWithGoogle()).rejects.toThrow("OAuth error");
  });

  test("異常: error の status を Error に載せる", async () => {
    mockSocialSignIn.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "Too many", status: 429 } } as unknown as {
        data: null;
        error: null;
      }),
    );
    const error = await signInWithGoogle().catch((e: unknown) => e);
    expect(signInErrorMessage(error)).toBe(
      "操作が集中しています。しばらく待ってから再度お試しください",
    );
  });
});

describe("auth.signInErrorMessage", () => {
  test("status が無い（fetch の失敗）なら通信の失敗として案内する", () => {
    expect(signInErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "通信に失敗しました。接続を確認して再度お試しください",
    );
  });

  test("5xx はサーバーのエラー、それ以外の 4xx は再読み込みを案内する", () => {
    expect(signInErrorMessage({ status: 503 })).toContain("サーバーでエラーが発生しました");
    expect(signInErrorMessage({ status: 400 })).toContain("ページを再読み込みして");
  });
});
