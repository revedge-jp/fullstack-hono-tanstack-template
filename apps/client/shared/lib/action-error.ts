import { z } from "zod";

// API のエラーレスポンス `{ ok: false, error: string }`（api-service の toHttp / 各ミドルウェア）。
const ActionErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type ActionResult = { ok: true } | { ok: false; message: string };

type ApiResponse = { ok: boolean; json: () => Promise<unknown> };

// Hono RPC のレスポンス型（ステータスごとの ClientResponse の union）から、そのルートが
// 返しうるエラーコードの union を取り出す。レスポンス型を丸ごと推論させてから分配するのは、
// 本文の型を直接推論させると TS が union の候補を1つに絞ってしまい、対応表の検査が効かないため。
type ErrorCodeOf<Res> = Res extends { json: () => Promise<infer Body> }
  ? Body extends { ok: false; error: infer Code extends string }
    ? Code
    : never
  : never;

// ルートの型に現れないコード。ミドルウェア（requireAuth / rate-limit / bodyLimit）と
// app.ts の notFound / onError が返すもの、および usecase 共通の "Unexpected"。
// どの action でも起こりうるので、各 action の対応表には書かせない。
const COMMON_MESSAGES: Record<string, string> = {
  Unexpected: "サーバーでエラーが発生しました。時間をおいて再度お試しください",
  "Internal Server Error": "サーバーでエラーが発生しました。時間をおいて再度お試しください",
  Unauthorized: "ログインの有効期限が切れました。ページを再読み込みしてログインし直してください",
  "Too Many Requests": "操作が集中しています。しばらく待ってから再度お試しください",
  "Payload Too Large": "送信内容が大きすぎます",
};

const NETWORK_ERROR_MESSAGE = "通信に失敗しました。接続を確認して再度お試しください";

/**
 * ブラウザから API を呼ぶ mutation（actions/*.ts）の結果を、画面に出せる `ActionResult` に
 * 変換する。**reject しない** — fetch 自体の失敗（オフライン等）も `{ ok: false }` で返すので、
 * 呼び出し側の pending 状態が戻らなくなることはない。
 *
 * API のエラーコード（"Conflict" 等）はそのまま画面に出さず、`messages` の日本語文言に
 * 置き換える。`messages` のキーはルートの型から推論したコード（共通の "Unexpected" を除く）で、
 * API 側にコードが増えると対応表の不足が typecheck で検出される。対応表に無いコードや
 * 本文が想定外の形（JSON でない 502 等）のときは `fallback` を出す。
 */
export async function toActionResult<Res extends ApiResponse>(
  request: () => Promise<Res>,
  options: {
    messages: Record<Exclude<ErrorCodeOf<Res>, "Unexpected">, string>;
    fallback: string;
  },
): Promise<ActionResult> {
  let res: Res;
  try {
    res = await request();
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
  if (res.ok) {
    return { ok: true };
  }
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = ActionErrorResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: options.fallback };
  }
  const messages: Record<string, string> = options.messages;
  const message = messages[parsed.data.error] ?? COMMON_MESSAGES[parsed.data.error];
  return { ok: false, message: message ?? options.fallback };
}
