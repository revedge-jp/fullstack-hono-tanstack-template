import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockSocialSignIn = mock(() => Promise.resolve({ data: null, error: null }));

await mock.module("@/shared/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: mockSocialSignIn,
    },
  },
}));

const { signInWithGoogle } = await import("./sign-in");

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
});
