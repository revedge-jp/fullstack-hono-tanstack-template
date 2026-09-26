import { describe, expect, test } from "bun:test";

import { withConnectingIp } from "./connecting-ip";

describe("withConnectingIp（Bun で直接受けるときの接続元）", () => {
  test("クライアントが送った CF-Connecting-IP / x-forwarded-for を捨て、実際の接続元を入れる", () => {
    const req = new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "CF-Connecting-IP": "1.2.3.4", "x-forwarded-for": "5.6.7.8", cookie: "a=b" },
      body: "{}",
    });

    const out = withConnectingIp(req, "127.0.0.1");

    expect(out.headers.get("CF-Connecting-IP")).toBe("127.0.0.1");
    expect(out.headers.get("x-forwarded-for")).toBeNull();
    expect(out.headers.get("cookie")).toBe("a=b");
    expect(out.method).toBe("POST");
  });

  test("接続元が取れなければ、送られてきた CF-Connecting-IP も使わない", () => {
    const req = new Request("http://localhost/", { headers: { "CF-Connecting-IP": "1.2.3.4" } });

    expect(withConnectingIp(req, undefined).headers.get("CF-Connecting-IP")).toBeNull();
  });

  test("本文をそのまま渡す", async () => {
    const req = new Request("http://localhost/", { method: "POST", body: "payload" });

    expect(await withConnectingIp(req, "127.0.0.1").text()).toBe("payload");
  });
});
