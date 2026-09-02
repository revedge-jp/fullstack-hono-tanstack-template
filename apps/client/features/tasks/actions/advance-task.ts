import { z } from "zod";

import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

const AdvanceTaskErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type AdvanceTaskResult = { ok: true } | { ok: false; message: string };

// mutation はブラウザから同一オリジンの API を直接呼ぶ（方針は actions/create-task.ts を参照）
export async function advanceTask(input: { id: string }): Promise<AdvanceTaskResult> {
  const res = await apiClient.api.tasks[":id"].$patch({ param: { id: input.id } });
  if (res.ok) {
    return { ok: true };
  }
  const parsed = AdvanceTaskErrorResponseSchema.safeParse(await res.json());
  return {
    ok: false,
    message: parsed.success ? parsed.data.error : "タスクの更新に失敗しました",
  };
}
