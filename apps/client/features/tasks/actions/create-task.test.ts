import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createApiMock } from "@/test-helpers/api-mock";

const api = createApiMock({ body: { ok: false, error: "Invalid" } });
await mock.module("@/shared/lib/browser-api-client", api.browserApiClientModule);

const { createTask } = await import("./create-task");

describe("tasks.createTask action", () => {
  beforeEach(() => api.reset());

  test("正常: API が成功を返す場合 { ok: true } を返し、title が渡る", async () => {
    const result = await createTask({ title: "Write docs" });
    expect(result).toEqual({ ok: true });
    expect(api.state.lastJson).toEqual({ title: "Write docs" });
    expect(api.state.lastPath).toBe("api.tasks.$post");
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    api.state.ok = false;
    api.state.body = { ok: false, error: "Conflict" };
    const result = await createTask({ title: "Write docs" });
    expect(result).toEqual({ ok: false, message: "Conflict" });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    api.state.ok = false;
    api.state.body = { unexpected: true };
    const result = await createTask({ title: "Write docs" });
    expect(result).toEqual({ ok: false, message: "タスクの作成に失敗しました" });
  });
});
