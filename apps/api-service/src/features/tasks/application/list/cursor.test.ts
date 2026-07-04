import { describe, expect, test } from "bun:test";

import { decodeTaskCursor, encodeTaskCursor } from "./cursor";

describe("task cursor codec", () => {
  test("encode → decode で往復できる", () => {
    const cursor = { createdAt: new Date("2026-07-04T09:00:00.123Z"), id: "task-1" };
    const encoded = encodeTaskCursor(cursor);
    const decoded = decodeTaskCursor(encoded);
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) {
      expect(decoded.value.createdAt.toISOString()).toBe("2026-07-04T09:00:00.123Z");
      expect(decoded.value.id).toBe("task-1");
    }
  });

  test("base64 に + と / が現れる id でも URL-safe に変換され往復できる", () => {
    // この id の JSON を btoa すると "+" と "/" の両方が base64 に現れる（事前計算済み）
    const cursor = { createdAt: new Date("2026-07-04T09:00:00.123Z"), id: "~?~?" };
    const rawBase64 = btoa(JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id }));
    expect(rawBase64).toContain("+");
    expect(rawBase64).toContain("/");

    const encoded = encodeTaskCursor(cursor);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = decodeTaskCursor(encoded);
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) {
      expect(decoded.value.id).toBe("~?~?");
    }
  });

  test("パディング除去された長さ(4n+3)のカーソルも往復できる", () => {
    // id "x" の JSON はパディング1文字が落ちるケース（事前計算済み: 除去後の長さ % 4 === 3）
    const cursor = { createdAt: new Date("2026-07-04T09:00:00.123Z"), id: "x" };
    const encoded = encodeTaskCursor(cursor);
    expect(encoded.length % 4).toBe(3);
    const decoded = decodeTaskCursor(encoded);
    expect(decoded.isOk()).toBe(true);
    if (decoded.isOk()) {
      expect(decoded.value.id).toBe("x");
    }
  });

  test("さまざまな長さの id で往復が壊れない（パディング全パターン網羅）", () => {
    for (let len = 1; len <= 12; len++) {
      const id = "a".repeat(len);
      const cursor = { createdAt: new Date("2026-07-04T09:00:00.123Z"), id };
      const decoded = decodeTaskCursor(encodeTaskCursor(cursor));
      expect(decoded.isOk()).toBe(true);
      if (decoded.isOk()) {
        expect(decoded.value.id).toBe(id);
      }
    }
  });

  test("エンコード結果は URL-safe（+ / = を含まない）", () => {
    const encoded = encodeTaskCursor({
      createdAt: new Date("2026-07-04T09:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  test("異常: base64 ですらない文字列は InvalidCursor", () => {
    const r = decodeTaskCursor("!!!not-base64!!!");
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("InvalidCursor");
    }
  });

  test("異常: base64 だが JSON でない場合は InvalidCursor", () => {
    const r = decodeTaskCursor(btoa("hello world"));
    expect(r.isErr()).toBe(true);
  });

  test("異常: JSON だが必須フィールド欠落は InvalidCursor", () => {
    expect(decodeTaskCursor(btoa(JSON.stringify({ t: "2026-07-04T09:00:00Z" }))).isErr()).toBe(
      true,
    );
    expect(decodeTaskCursor(btoa(JSON.stringify({ id: "task-1" }))).isErr()).toBe(true);
    expect(decodeTaskCursor(btoa(JSON.stringify({ t: "2026-07-04", id: "" }))).isErr()).toBe(true);
    expect(decodeTaskCursor(btoa(JSON.stringify(null))).isErr()).toBe(true);
    expect(decodeTaskCursor(btoa(JSON.stringify("str"))).isErr()).toBe(true);
  });

  test("異常: 日付が不正な場合は InvalidCursor", () => {
    const r = decodeTaskCursor(btoa(JSON.stringify({ t: "not-a-date", id: "task-1" })));
    expect(r.isErr()).toBe(true);
  });
});
