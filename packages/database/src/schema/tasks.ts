import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "./auth";

export const TASK_STATUS_VALUES = ["todo", "in_progress", "done"] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("todo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tasks_owner_id_title_unique").on(table.ownerId, table.title),
    // domain の TaskStatus 不変条件を DB でも強制する。
    // infrastructure の reconstituteTask は「DB の値は信頼できる」前提で as キャストしており
    // （ADR-004）、この CHECK 制約がその前提を実際に担保する。
    check("tasks_status_check", sql`${table.status} IN ('todo', 'in_progress', 'done')`),
  ],
);

export type DbTask = typeof tasks.$inferSelect;
