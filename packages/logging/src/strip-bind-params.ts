// drizzle-orm の DrizzleQueryError はメッセージ末尾に `\nparams: <バインド値>` を埋め込む
// (OAuth の codeVerifier・state・メールアドレス等)。pino の redact はキー単位でしか効かず
// 文字列の中身には届かないため、ログやレスポンスに載せる前に文字列として切り落とす。
const BIND_PARAMS_MARKER = "\nparams:";
const STACK_FRAME_LINE = /\n\s+at /;

/**
 * メッセージからバインド値(`\nparams:` 以降)を切り落とす。SQL 文は残す。
 */
export function stripBindParams(message: string): string {
  const markerIndex = message.indexOf(BIND_PARAMS_MARKER);
  return markerIndex === -1 ? message : message.slice(0, markerIndex);
}

/**
 * stack の先頭はメッセージの複製なので、そこに含まれるバインド値だけを切り落とし、
 * 呼び出しフレーム(`at …` の行)は残す。フレームが見つからなければ末尾まで切り落とす。
 */
export function stripBindParamsFromStack(stack: string): string {
  const markerIndex = stack.indexOf(BIND_PARAMS_MARKER);
  if (markerIndex === -1) {
    return stack;
  }
  const rest = stack.slice(markerIndex + BIND_PARAMS_MARKER.length);
  const frameIndex = rest.search(STACK_FRAME_LINE);
  return stack.slice(0, markerIndex) + (frameIndex === -1 ? "" : rest.slice(frameIndex));
}
