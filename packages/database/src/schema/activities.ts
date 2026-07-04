import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});

export type DbActivity = typeof activities.$inferSelect;
