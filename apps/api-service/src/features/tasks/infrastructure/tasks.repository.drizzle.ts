import { isPgError } from "@app/shared/db-error";
import { type Database, tasks } from "@repo/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
import type { TasksRepository } from "../domain/tasks.repository";
import { mapDbTaskToDomain } from "./mappers";

export function createTasksRepository(deps: { db: Database }): TasksRepository {
  const { db } = deps;

  return {
    create: (input) =>
      ResultAsync.fromPromise(db.insert(tasks).values(input).returning(), (e) =>
        isPgError(e, "23505") ? ("Conflict" as const) : ("Unexpected" as const),
      ).andThen((rows) => {
        const row = rows[0];
        return row ? ok(mapDbTaskToDomain(row)) : err("Unexpected" as const);
      }),

    list: ({ ownerId, limit, after }) =>
      ResultAsync.fromPromise(
        db.query.tasks.findMany({
          where: and(
            eq(tasks.ownerId, ownerId),
            // keyset: (createdAt, id) の複合キーで after より「後ろ」（降順で古い側）に絞る。
            // createdAt が同時刻の行は id でタイブレークする（OFFSET と違い行ズレしない）
            after
              ? or(
                  lt(tasks.createdAt, after.createdAt),
                  and(eq(tasks.createdAt, after.createdAt), lt(tasks.id, after.id)),
                )
              : undefined,
          ),
          orderBy: [desc(tasks.createdAt), desc(tasks.id)],
          // limit+1 件フェッチして「次のページがあるか」を判定する
          limit: limit + 1,
        }),
        () => "Unexpected" as const,
      ).map((rows) => ({
        items: rows.slice(0, limit).map(mapDbTaskToDomain),
        hasMore: rows.length > limit,
      })),

    getById: (id, ownerId) =>
      ResultAsync.fromPromise(
        db.query.tasks.findFirst({ where: and(eq(tasks.id, id), eq(tasks.ownerId, ownerId)) }),
        () => "Unexpected" as const,
      ).map((row) => (row ? mapDbTaskToDomain(row) : null)),

    update: (task) =>
      ResultAsync.fromPromise(
        db
          .update(tasks)
          .set({ status: task.status, updatedAt: new Date() })
          .where(and(eq(tasks.id, task.id), eq(tasks.ownerId, task.ownerId)))
          .returning(),
        () => "Unexpected" as const,
      ).andThen((rows) => {
        const row = rows[0];
        return row ? ok(mapDbTaskToDomain(row)) : err("NotFound" as const);
      }),

    delete: (id, ownerId) =>
      ResultAsync.fromPromise(
        db
          .delete(tasks)
          .where(and(eq(tasks.id, id), eq(tasks.ownerId, ownerId)))
          .returning({ id: tasks.id }),
        () => "Unexpected" as const,
      ).andThen((rows) => (rows.length > 0 ? ok(undefined) : err("NotFound" as const))),
  };
}
