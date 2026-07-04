import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("tasks_owner_id_title_unique").on(table.ownerId, table.title)],
);

export type DbTask = typeof tasks.$inferSelect;
