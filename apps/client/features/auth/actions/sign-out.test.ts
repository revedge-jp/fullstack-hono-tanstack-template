import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockSignOut = mock(() => Promise.resolve({ data: null, error: null }));

mock.module("@/shared/lib/auth-client", () => ({
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

  test("異常: authClient.signOut がエラーを投げた場合は伝播する", async () => {
    mockSignOut.mockImplementationOnce(() => Promise.reject(new Error("network error")));
    await expect(signOut()).rejects.toThrow("network error");
  });
});
