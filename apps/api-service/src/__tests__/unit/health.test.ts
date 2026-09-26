import { describe, expect, test } from "bun:test";

import { createFakeApp } from "api-service/test-helpers";

// 手動ロールバック（docs/deploy/operations.md）は infraCommit を読んで、どの alchemy.run.ts でデプロイするかを決める。
// これが応答から消えると commit（アプリの版）に黙って戻り、自動ロールバックの後に新しいリソースを削除する
describe("/api/health/live", () => {
  test("アプリの版とインフラの定義の版を別々に返す", async () => {
    const app = createFakeApp({
      version: { appVersion: "v1", gitSha: "app-sha", infraSha: "infra-sha" },
    });
    const res = await app.request("/api/health/live");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "v1",
      commit: "app-sha",
      infraCommit: "infra-sha",
    });
  });
});
