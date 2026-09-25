import { beforeEach, describe, expect, mock, test } from "bun:test";

type SignOutResult = { data: null; error: { message?: string; status: number } | null };
const mockSignOut = mock(
  (): Promise<SignOutResult> => Promise.resolve({ data: null, error: null }),
);

await mock.module("@/shared/lib/auth-client", () => ({
  authClient: {
    signOut: mockSignOut,
  },
}));

const { signOut } = await import("./sign-out");

describe("auth.signOut", () => {
  beforeEach(() => {
    mockSignOut.mockClear();
  });

  test("authClient.signOut を呼び出す", async () => {
    await signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test("異常: error が返った場合は例外を投げる（HTTP エラーは throw されず error で返る）", async () => {
    mockSignOut.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "Internal Server Error", status: 500 } }),
    );
    await expect(signOut()).rejects.toThrow("Internal Server Error");
  });

  test("異常: authClient.signOut がエラーを投げた場合は伝播する", async () => {
    mockSignOut.mockImplementationOnce(() => Promise.reject(new Error("network error")));
    await expect(signOut()).rejects.toThrow("network error");
  });
});
