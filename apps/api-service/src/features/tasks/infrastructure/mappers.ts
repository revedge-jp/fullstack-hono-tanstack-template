import type { DbTask } from "@repo/db";
import { reconstituteTask } from "../domain/models";

export function mapDbTaskToDomain(row: DbTask) {
  return reconstituteTask({
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
