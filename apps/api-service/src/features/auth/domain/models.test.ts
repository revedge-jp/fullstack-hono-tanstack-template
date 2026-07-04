import { describe, expect, test } from "bun:test";

import { reconstituteAuthUser } from "./models";

describe("reconstituteAuthUser", () => {
  test("id/email/name をそのまま保持する", () => {
    const user = reconstituteAuthUser({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
    });
    expect(user.id).toBe("user-1" as typeof user.id);
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
  });
});
