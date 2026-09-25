import { type ActionResult, toActionResult } from "@/shared/lib/action-error";
import { browserApiClient as apiClient } from "@/shared/lib/browser-api-client";

// mutation はブラウザから同一オリジンの API を直接呼ぶ（cookie は同送される）。
// createServerFn にしない理由: サーバー関数化すると実行がサーバー側になり、
// CF Workers では自オリジンへの HTTP ループバックが不可（ADR-001）。
// SSR での先読みが必要な query と違い、mutation はユーザー操作起点なので
// ブラウザから直接呼ぶのが最も単純で確実（features/auth/actions と同じ方針）。
// 入力の本検証はサーバー側（zValidator + domain）が担う。
// API のエラーコードは画面に出さず、toActionResult（shared/lib/action-error.ts）で文言に
// 置き換える。messages のキーはルートの型から推論され、過不足は typecheck で検出される。
export function createTask(input: { title: string }): Promise<ActionResult> {
  return toActionResult(() => apiClient.api.tasks.$post({ json: { title: input.title } }), {
    messages: {
      Invalid: "タイトルは1〜200文字で入力してください",
      Conflict: "同じタイトルのタスクが既にあります",
    },
    fallback: "タスクの作成に失敗しました",
  });
}
