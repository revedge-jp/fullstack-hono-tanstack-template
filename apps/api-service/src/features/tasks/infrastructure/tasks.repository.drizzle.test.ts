import { describe, expect, test } from "bun:test";

import type { Database } from "@repo/db";

import { createLoggerSpy } from "../../../test-helpers/create-logger-spy";
import { createTasksRepository } from "./tasks.repository.drizzle";

// DB 障害は "Unexpected" に畳まれて toHttp の 500 ログに種別が残らないので、リポジトリで原因を
// 残していることを確かめる（DB の停止とマイグレーションの当て忘れを見分けるため）。
describe("tasks repository — DB 障害", () => {
  test("list が失敗したら SQLSTATE を warn に残して Unexpected を返す", async () => {
    const cause = Object.assign(new Error('relation "tasks" does not exist'), { code: "42P01" });
    const db = {
      query: {
        tasks: {
          findMany: () => Promise.reject(Object.assign(new Error("Failed query"), { cause })),
        },
      },
    } as unknown as Database;
    const spy = createLoggerSpy();

    const result = await createTasksRepository({ db, logger: spy.logger }).list({
      ownerId: "owner-1",
      limit: 10,
    });

    expect(result._unsafeUnwrapErr()).toBe("Unexpected");
    expect(spy.warn).toEqual([
      [
        { operation: "tasks.list", causeCode: "42P01", detail: expect.any(String) },
        "db_query_failed",
      ],
    ]);
  });
});
