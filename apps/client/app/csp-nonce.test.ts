import { describe, expect, test } from "bun:test";

import { createCspNonce, getCspNonce, runWithCspNonce } from "./csp-nonce";

describe("app/csp-nonce", () => {
  test("毎回違う 128 bit の値を base64 で返す", () => {
    const a = createCspNonce();
    const b = createCspNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });

  test("runWithCspNonce の中だけで nonce を読める（非同期をまたいでも）", async () => {
    expect(getCspNonce()).toBeUndefined();
    const seen = await runWithCspNonce("n1", async () => {
      await Promise.resolve();
      return getCspNonce();
    });
    expect(seen).toBe("n1");
    expect(getCspNonce()).toBeUndefined();
  });
});
