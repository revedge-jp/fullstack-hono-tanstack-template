// drizzle-orm の DrizzleQueryError はメッセージ末尾に `\nparams: <バインド値>` を埋め込む
// (OAuth の codeVerifier・state・メールアドレス等)。pino の redact はキー単位でしか効かず
// 文字列の中身には届かないため、ログやレスポンスに載せる前に文字列として切り落とす。
const BIND_PARAMS_MARKER = "\nparams:";

/**
 * メッセージからバインド値(`\nparams:` 以降)を切り落とす。SQL 文は残す。
 */
export function stripBindParams(message: string): string {
  const markerIndex = message.indexOf(BIND_PARAMS_MARKER);
  return markerIndex === -1 ? message : message.slice(0, markerIndex);
}

/**
 * stack の先頭はメッセージの複製なので、その部分だけをバインド値を落としたメッセージに置き換え、
 * 呼び出しフレームは残す。フレームの始まりを stack の文字列(`at …` の行)から探すと、バインド値
 * 自体が改行と `at ` を含むときに誤認するため、既知のメッセージの位置で切る。stack 中にメッセージが
 * 見つからない(生成後に message が書き換えられた等)ときや、置き換えた後もメッセージの外に
 * バインド値が残る(内側の例外の stack を連結したラッパー等)ときは、安全側に倒してメッセージだけを返す。
 */
export function stripBindParamsFromStack(stack: string, message: string): string {
  const messageIndex = stack.indexOf(message);
  if (messageIndex === -1) {
    return stripBindParams(message);
  }
  const replaced =
    stack.slice(0, messageIndex) +
    stripBindParams(message) +
    stack.slice(messageIndex + message.length);
  return replaced.includes(BIND_PARAMS_MARKER) ? stripBindParams(message) : replaced;
}
