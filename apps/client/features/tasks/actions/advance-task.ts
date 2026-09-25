import { type ActionResult, toActionResult } from "@/shared/lib/action-error";
import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

// mutation はブラウザから同一オリジンの API を直接呼ぶ（方針は actions/create-task.ts を参照）
export function advanceTask(input: { id: string }): Promise<ActionResult> {
  return toActionResult(() => apiClient.api.tasks[":id"].$patch({ param: { id: input.id } }), {
    messages: {
      AlreadyDone: "このタスクは既に完了しています",
      Conflict: "他の操作でタスクの状態が変わりました。再読み込みしてからやり直してください",
      NotFound: "タスクが見つかりません。削除された可能性があります",
    },
    fallback: "タスクの更新に失敗しました",
  });
}
