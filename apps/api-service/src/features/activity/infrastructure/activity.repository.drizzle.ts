import { toUnexpectedDbError } from "@app/shared/db-error";
import { activities, type Database } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";

import type { ActivityRepository } from "../domain/activity.repository";
import { mapDbActivityToDomain } from "./mappers";

type WarnLogger = { warn: (obj: unknown, msg?: string) => void };

export function createActivityRepository(deps: {
  db: Database;
  logger: WarnLogger;
}): ActivityRepository {
  const { db, logger } = deps;

  return {
    record: (input) =>
      ResultAsync.fromPromise(
        db.insert(activities).values(input).returning(),
        toUnexpectedDbError(logger, "activity.record"),
      ).andThen((rows) => {
        const row = rows[0];
        return row ? ok(mapDbActivityToDomain(row)) : err("Unexpected" as const);
      }),

    list: (input) =>
      ResultAsync.fromPromise(
        db.query.activities.findMany({
          where: eq(activities.ownerId, input.ownerId),
          orderBy: [desc(activities.occurredAt)],
          limit: 50,
        }),
        toUnexpectedDbError(logger, "activity.list"),
      ).map((rows) => ({ items: rows.map(mapDbActivityToDomain) })),
  };
}
