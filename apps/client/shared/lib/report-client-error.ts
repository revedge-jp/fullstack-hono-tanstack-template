// クライアント(ブラウザ)側 JS エラーの自前通報。
// 第三者(Sentry 等)へ利用者情報を出さないため、送るのは message / stack / パス / バージョンのみに
// 限定し、送信前に既知の PII パターンをスクラブする。宛先は自オリジンの api-service
// (/api/client-errors)で、そこから Cloudflare Workers observability のログに流れる。
//
// window.onerror / unhandledrejection のグローバル捕捉に加え、React error boundary
// (ErrorFallbackContent の effect)からも reportReactError を呼ぶ。
//
// 送信は意図的に生の fetch を使う(アプリ標準の hc<AppType> クライアントは使わない)。この
// モジュールはエラー処理経路そのもので動くため、通報が新たなエラーを生まないよう依存を最小化し、
// クライアントのラッパ(recordAppVersion 等の副作用)を経由させない。

import { getObservedAppVersion } from "./app-version";

type ClientErrorKind = "error" | "unhandledrejection" | "react-error-boundary";

// レート制限は「一定時間あたりの件数」にする。ハードなセッション上限だと、タブを1日
// 開きっぱなしにする運用で、一度上限に達すると以降ずっと通報が止まってしまう。
// 時間窓なら経過とともに枠が空き、恒久的に黙ることはない。
const REPORT_WINDOW_MS = 5 * 60_000;
const MAX_REPORTS_PER_WINDOW = 20;
// 同一エラーの抑制も時間窓にする。永続 dedup だと、再発しているエラーが最初の1回しか出ず、
// 一過性か恒常的かを判別できない。窓を過ぎたら再通報して頻度を可視化する。
const DEDUPE_WINDOW_MS = 5 * 60_000;
// dedup 用 Map の上限。窓が回り続ける長寿命タブで無限に溜めないため、超えたらクリアして
// メモリを一定に保つ(古いエラーの再通報を許容)。
const MAX_DEDUPE_KEYS = 100;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 4000;
// パスの上限。サーバー(routes/client-errors)のスキーマと一致させ、超過で report 全体が
// 400 で捨てられないよう client 側で切り詰める。
const MAX_PATH_LENGTH = 500;

// 直近で送信を試みた時刻(ミリ秒)。窓外は都度間引く。送信に失敗したスロットは解放し、
// 失敗が枠を食い潰さないようにする。
let reportTimestamps: number[] = [];
// dedup: key -> { 最後に実際に通報した時刻, その時の重要度ランク }。
const lastReported = new Map<string, { at: number; rank: number }>();
// window の error/unhandledrejection リスナを二重登録しないためのガード。
let installed = false;

// 重要度ランク。react-error-boundary は実際に画面を壊したクラッシュ(サーバー側で error ログ)、
// それ以外はグローバルハンドラ由来(warn ログ)。同一エラーが両方から届いたとき、より重要な
// 側の通報を1回だけ通す(warn に埋もれさせない)。
function kindRank(kind: ClientErrorKind): number {
  return kind === "react-error-boundary" ? 2 : 1;
}

function releaseSlot(at: number): void {
  const index = reportTimestamps.indexOf(at);
  if (index >= 0) {
    reportTimestamps.splice(index, 1);
  }
}

// unhandledrejection の reason から可能な限り有用な message を取り出す。非 Error でも
// { message } を持つ値(DOMException 風・API エラーオブジェクト等)は message を活かし、
// null/undefined は空にして呼び出し側の既定に委ねる(String(reason) の "[object Object]" や
// "null" を避ける)。
function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (reason === null || reason === undefined) {
    return "";
  }
  if (typeof reason === "object") {
    const message = (reason as { message?: unknown }).message;
    return typeof message === "string" ? message : "[object]";
  }
  // ここに来るのは string/number/boolean/symbol/bigint/function だけ(object は上で除外済み)
  // oxlint-disable-next-line typescript/no-base-to-string
  return String(reason);
}

// メール・電話番号のような数字列を伏せる(message/stack への PII 混入の保険)。
// 任意テキストの完全なスクラブは不可能なため、そもそも props やフォーム値は
// 送らず、既知パターンのみ最後の防波堤として伏せる。数字クラスは「数字・空白・ハイフン」に
// 留め、\s(改行を含む)は使わない: 改行をまたぐとスタックトレース(この機能が集めたい情報
// そのもの)を潰すため。空白区切りの番号は拾いつつ、行またぎはしない。
function scrubText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d[-\d ]{7,}\d\b/g, "[number]");
}

// パスから PII になりうる可変部を除く: クエリ/ハッシュは付けず、UUID セグメントは :id に畳む
// (エンティティ ID 等の露出を避ける)。
function scrubPath(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .slice(0, MAX_PATH_LENGTH);
}

function reportClientError(input: {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  const message = scrubText(input.message).slice(0, MAX_MESSAGE_LENGTH);
  if (message.length === 0) {
    return;
  }
  const stack = input.stack ? scrubText(input.stack).slice(0, MAX_STACK_LENGTH) : undefined;

  // 同一エラー(message + stack)の連発は時間窓内で1件に畳む。kind は含めない: 同じエラーが
  // window.onerror と error boundary の両方から届いても二重送信しないため。ただし後から
  // より重要な kind(クラッシュ)が届いたら、その1回だけは通す。
  const dedupeKey = `${message}:${stack ?? ""}`;
  const now = Date.now();
  const rank = kindRank(input.kind);
  const prev = lastReported.get(dedupeKey);
  if (prev && now - prev.at < DEDUPE_WINDOW_MS && rank <= prev.rank) {
    return;
  }

  reportTimestamps = reportTimestamps.filter((t) => now - t < REPORT_WINDOW_MS);
  if (reportTimestamps.length >= MAX_REPORTS_PER_WINDOW) {
    return;
  }

  lastReported.set(dedupeKey, { at: now, rank });
  if (lastReported.size > MAX_DEDUPE_KEYS) {
    lastReported.clear();
  }
  reportTimestamps.push(now);

  const body = JSON.stringify({
    kind: input.kind,
    message,
    stack,
    path: scrubPath(window.location.pathname),
    appVersion: getObservedAppVersion() ?? undefined,
  });

  // fire-and-forget。通報自体の失敗はユーザー操作に一切影響させない(握りつぶす)。
  // keepalive: タブ遷移・アンロード中でも送信を取りこぼさない。
  // 送信に失敗したらこの試行のスロットを解放し、失敗がレート枠を消費しないようにする。
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) {
          releaseSlot(now);
        }
      })
      .catch(() => {
        releaseSlot(now);
      });
  } catch {
    // fetch 自体が同期例外を投げても無視する(通報が新たなグローバルエラーを生まないように)。
    releaseSlot(now);
  }
}

// try/catch で握り潰す(＝画面は続行させる)が、発生自体は把握したいエラーを通報する。
// ブラウザの console に書くだけだと開発者の手元にしか残らないため、この経路に寄せる
// (サーバー側は /api/client-errors が pino で記録する)。
export function reportHandledError(error: unknown, context: string): void {
  const message = error instanceof Error ? error.message || String(error) : String(error);
  reportClientError({
    kind: "error",
    message: `${context}: ${message}`,
    stack: error instanceof Error ? error.stack : undefined,
  });
}

// React error boundary から呼ぶ(実際の呼び出し元は ErrorFallbackContent の effect)。
export function reportReactError(error: Error): void {
  reportClientError({
    kind: "react-error-boundary",
    message: error.message || String(error),
    stack: error.stack,
  });
}

// ブラウザのグローバルエラー捕捉を仕掛ける(client エントリで一度だけ呼ぶ)。SSR では何もしない。
// 二重呼び出し(dev の HMR 等)でもリスナを重複登録しない。
export function installClientErrorReporting(): void {
  if (typeof window === "undefined" || installed) {
    return;
  }
  installed = true;
  window.addEventListener("error", (event) => {
    // リソース読み込み失敗(img/script)の error イベントは message を持たないので除外する。
    if (!event.message) {
      return;
    }
    reportClientError({
      kind: "error",
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError({
      kind: "unhandledrejection",
      message: reasonMessage(reason) || "unhandledrejection",
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

// テスト用: モジュールスコープの状態(レート枠・dedup・install ガード)をリセットする。
export function resetClientErrorReportingForTest(): void {
  reportTimestamps = [];
  lastReported.clear();
  installed = false;
}
