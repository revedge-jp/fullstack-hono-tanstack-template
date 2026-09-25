import { type ActionResult, toActionResult } from "@/shared/lib/action-error";
import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

// mutation はブラウザから同一オリジンの API を直接呼ぶ（方針は actions/create-task.ts を参照）
export function deleteTask(input: { id: string }): Promise<ActionResult> {
  return toActionResult(() => apiClient.api.tasks[":id"].$delete({ param: { id: input.id } }), {
    messages: {
      NotFound: "タスクが見つかりません。既に削除された可能性があります",
    },
    fallback: "タスクの削除に失敗しました",
  });
}
