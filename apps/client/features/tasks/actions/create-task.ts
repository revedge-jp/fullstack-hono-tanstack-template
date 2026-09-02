import { z } from "zod";

import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

const CreateTaskErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type CreateTaskResult = { ok: true } | { ok: false; message: string };

// mutation はブラウザから同一オリジンの API を直接呼ぶ（cookie は同送される）。
// createServerFn にしない理由: サーバー関数化すると実行がサーバー側になり、
// CF Workers では自オリジンへの HTTP ループバックが不可（ADR-001）。
// SSR での先読みが必要な query と違い、mutation はユーザー操作起点なので
// ブラウザから直接呼ぶのが最も単純で確実（features/auth/actions と同じ方針）。
// 入力の本検証はサーバー側（zValidator + domain）が担う。
export async function createTask(input: { title: string }): Promise<CreateTaskResult> {
  const res = await apiClient.api.tasks.$post({ json: { title: input.title } });
  if (res.ok) {
    return { ok: true };
  }
  const parsed = CreateTaskErrorResponseSchema.safeParse(await res.json());
  return {
    ok: false,
    message: parsed.success ? parsed.data.error : "タスクの作成に失敗しました",
  };
}
