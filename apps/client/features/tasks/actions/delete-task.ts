import { z } from "zod";

import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

const DeleteTaskErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type DeleteTaskResult = { ok: true } | { ok: false; message: string };

// mutation はブラウザから同一オリジンの API を直接呼ぶ（方針は actions/create-task.ts を参照）
export async function deleteTask(input: { id: string }): Promise<DeleteTaskResult> {
  const res = await apiClient.api.tasks[":id"].$delete({ param: { id: input.id } });
  if (res.ok) {
    return { ok: true };
  }
  const parsed = DeleteTaskErrorResponseSchema.safeParse(await res.json());
  return {
    ok: false,
    message: parsed.success ? parsed.data.error : "タスクの削除に失敗しました",
  };
}
