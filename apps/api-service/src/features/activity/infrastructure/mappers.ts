import type { DbActivity } from "@repo/db";

import { reconstituteActivity } from "../domain/models";

export function mapDbActivityToDomain(row: DbActivity) {
  return reconstituteActivity({
    id: row.id,
    kind: row.kind,
    message: row.message,
    occurredAt: row.occurredAt,
  });
}
