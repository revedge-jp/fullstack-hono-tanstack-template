import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./auth";

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // activity は記録したユーザー本人にのみ見せる（越境閲覧の禁止）。tasks と同じ cascade 方針。
    ownerId: text("owner_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 一覧のホットパス WHERE owner_id = ? ORDER BY occurred_at DESC LIMIT 50 用
    index("activities_owner_occurred_idx").on(table.ownerId, table.occurredAt.desc()),
  ],
);

export type DbActivity = typeof activities.$inferSelect;
