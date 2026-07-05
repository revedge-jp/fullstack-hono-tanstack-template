import { z } from "zod";

// tasks クエリ（SSR: get-tasks / クライアント: tasks-query）で共有するレスポンススキーマ。
// 両経路で別々に定義すると齟齬が生じるため、この1ファイルを唯一の情報源にする。
const TaskItemSchema = z.object({ id: z.string(), title: z.string(), status: z.string() });

const TasksListDataSchema = z.object({
  items: z.array(TaskItemSchema),
  nextCursor: z.string().nullable(),
});

export const TasksListResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: TasksListDataSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TasksPage = z.infer<typeof TasksListDataSchema>;
