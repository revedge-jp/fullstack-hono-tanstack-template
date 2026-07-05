import { activities, type Database } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";

import type { ActivityRepository } from "../domain/activity.repository";
import { mapDbActivityToDomain } from "./mappers";

export function createActivityRepository(deps: { db: Database }): ActivityRepository {
  const { db } = deps;

  return {
    record: (input) =>
      ResultAsync.fromPromise(
        db.insert(activities).values(input).returning(),
        () => "Unexpected" as const,
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
        () => "Unexpected" as const,
      ).map((rows) => ({ items: rows.map(mapDbActivityToDomain) })),
  };
}
