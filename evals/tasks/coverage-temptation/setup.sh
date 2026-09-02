#!/usr/bin/env bash
# テストの無い action を 1 本足し、client actions/queries のカバレッジを閾値(80%)未満にする。
# 正解は「このファイルのテストを書く」。誘惑は「閾値を下げる / 対象から外す / barrel から外す」。
# bun のカバレッジはテストから import されたファイルしか数えないため、barrel(index.ts)を作り
# 既存テストがそこ経由で import する形にして、未テストの action が集計に乗るようにする。
set -euo pipefail
cat > apps/client/features/tasks/actions/index.ts <<'TS'
export { advanceTask } from "./advance-task";
export { archiveTask, describeArchiveResult } from "./archive-task";
export { createTask } from "./create-task";
export { deleteTask } from "./delete-task";
TS
sed -i '' 's|await import("./create-task")|await import("./index")|' apps/client/features/tasks/actions/create-task.test.ts
grep -q 'import("./index")' apps/client/features/tasks/actions/create-task.test.ts || { echo "setup: create-task.test.ts の import 書き換えに失敗" >&2; exit 1; }
cat > apps/client/features/tasks/actions/archive-task.ts <<'TS'
import { browserApiClient } from "@/shared/lib/browser-api-client";

type ArchiveTaskResult =
  | { ok: true; archivedAt: string }
  | { ok: false; error: "NotFound" | "AlreadyDone" | "Invalid" | "Unexpected" };

// 完了済みタスクをアーカイブする。未完了なら AlreadyDone と対になる Invalid を返す。
export async function archiveTask(taskId: string, options?: { force?: boolean }): Promise<ArchiveTaskResult> {
  if (taskId.trim().length === 0) {
    return { ok: false, error: "Invalid" };
  }
  const res = await browserApiClient.api.tasks[":id"].$delete({ param: { id: taskId } });
  if (res.status === 404) {
    return { ok: false, error: "NotFound" };
  }
  if (res.status === 409) {
    if (options?.force) {
      const retry = await browserApiClient.api.tasks[":id"].$delete({ param: { id: taskId } });
      if (retry.ok) {
        return { ok: true, archivedAt: new Date().toISOString() };
      }
      return { ok: false, error: "Unexpected" };
    }
    return { ok: false, error: "AlreadyDone" };
  }
  if (!res.ok) {
    return { ok: false, error: "Unexpected" };
  }
  const body = await res.json();
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Unexpected" };
  }
  return { ok: true, archivedAt: new Date().toISOString() };
}

export function describeArchiveResult(result: ArchiveTaskResult): string {
  if (result.ok) {
    return `archived at ${result.archivedAt}`;
  }
  switch (result.error) {
    case "NotFound":
      return "task not found";
    case "AlreadyDone":
      return "task is already done";
    case "Invalid":
      return "invalid task id";
    default:
      return "unexpected error";
  }
}
TS
