import { describe, expect, test } from "bun:test";
import { all, allAsync, err, flow, isOk, ok, tryCatch } from "./index";

describe("ok", () => {
  test("type が ok で value を保持する", () => {
    const r = ok(42);
    expect(r.type).toBe("ok");
    expect(r.value).toBe(42);
  });
});

describe("err", () => {
  test("type が err で value を保持する", () => {
    const r = err("NotFound");
    expect(r.type).toBe("err");
    expect(r.value).toBe("NotFound");
  });
});

describe("isOk", () => {
  test("ok の場合は true を返す", () => {
    expect(isOk(ok(1))).toBe(true);
  });

  test("err の場合は false を返す", () => {
    expect(isOk(err("e"))).toBe(false);
  });
});

describe("all", () => {
  test("全て ok の場合は values の配列を返す", () => {
    const r = all([ok(1), ok(2), ok(3)]);
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value).toEqual([1, 2, 3]);
    }
  });

  test("1 つでも err があれば最初の err を返す", () => {
    const r = all([ok(1), err("Fail"), ok(3)]);
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Fail");
    }
  });

  test("空配列は ok([]) を返す", () => {
    const r = all([]);
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value).toEqual([]);
    }
  });
});

describe("allAsync", () => {
  test("全て ok の場合は values の配列を返す", async () => {
    const r = await allAsync([Promise.resolve(ok(1)), Promise.resolve(ok(2))]);
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value).toEqual([1, 2]);
    }
  });

  test("err が含まれる場合はその err を返す", async () => {
    const r = await allAsync([Promise.resolve(ok(1)), Promise.resolve(err("Fail"))]);
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Fail");
    }
  });
});

describe("tryCatch", () => {
  test("成功時は ok を返す", async () => {
    const r = await tryCatch(
      async () => 42,
      () => "Error",
    );
    expect(r).toEqual(ok(42));
  });

  test("例外時は err を返す", async () => {
    const r = await tryCatch(
      async () => {
        throw new Error("boom");
      },
      (e) => (e instanceof Error ? e.message : "Unknown"),
    );
    expect(r).toEqual(err("boom"));
  });
});

describe("flow", () => {
  test("map で値を変換できる", async () => {
    const r = await flow(1)
      .map((x) => x + 1)
      .value();
    expect(r).toEqual(ok(2));
  });

  test("andThen で ok を連鎖できる", async () => {
    const r = await flow(1)
      .andThen((x) => ok(x * 2))
      .value();
    expect(r).toEqual(ok(2));
  });

  test("andThen で err が返ると以降はスキップされる", async () => {
    const r = await flow(1)
      .andThen(() => err("Fail" as const))
      .map((x) => x + 100)
      .value();
    expect(r).toEqual(err("Fail"));
  });

  test("asyncAndThen で非同期処理を連鎖できる", async () => {
    const r = await flow(1)
      .asyncAndThen(async (x) => ok(x + 10))
      .value();
    expect(r).toEqual(ok(11));
  });
});
