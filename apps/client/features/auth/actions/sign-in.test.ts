import { describe, expect, mock, test } from "bun:test";

const mockSocialSignIn = mock(() => Promise.resolve({ data: null, error: null }));

mock.module("@/shared/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: mockSocialSignIn,
    },
  },
}));

// window.location.origin が必要なため globalThis に設定
Object.defineProperty(globalThis, "window", {
  value: { location: { origin: "http://localhost" } },
  writable: true,
});

const { signInWithGoogle } = await import("./sign-in");

describe("auth.signInWithGoogle", () => {
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
