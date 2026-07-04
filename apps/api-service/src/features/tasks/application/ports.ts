import type { ResultAsync } from "neverthrow";

/**
 * tasks が「他 feature と連携したい」という意図だけを表明する差し込み口(ポート)。
 * tasks は activity feature の存在を知らず、この抽象型にのみ依存する。
 * 実装(アダプタ)は integrations/composition に置き、container.ts が注入する。
 */
export type ActivityRecorder = {
  recordTaskCreated(task: { id: string; title: string }): ResultAsync<void, "Unexpected">;
};
