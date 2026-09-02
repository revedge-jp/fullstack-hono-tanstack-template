import type { RequestLogger } from "@app/middlewares/request-logger";

// ロガーに渡された1回分の引数。pino 互換の (payload, message?) の形をそのまま保持する。
type LogCall = [payload: unknown, message?: string];

export type LoggerSpy = {
  info: LogCall[];
  warn: LogCall[];
  error: LogCall[];
  logger: RequestLogger;
};

/**
 * requestLogger ミドルウェアが context に載せるロガーの代役。
 *
 * レベルごとに呼び出し引数をそのまま配列へ記録するので、「どのレベルに、どんなフィールド名で
 * 出したか」まで検証できる（`expect(spy.warn[0]).toEqual([{ errorCode: "NotFound", status: 404 },
 * "request_error"])` のように書く）。`child()` は自分自身を返すため、リクエストスコープの
 * 子ロガーを作る経路でも同じ配列に記録される。
 *
 * `bun:test` の mock を使わないのは、このファイルが `src/` 配下の非テストファイルであり、
 * テストランナー専用モジュールへの import をアプリのモジュールグラフに持ち込まないため
 * （同じ test-helpers/ にある create-fake-app.ts も素の関数だけで組まれている）。
 * 呼び出し引数が素の配列なので、mock 型を経由するより型検査も効く。
 */
export function createLoggerSpy(): LoggerSpy {
  const info: LogCall[] = [];
  const warn: LogCall[] = [];
  const error: LogCall[] = [];
  const logger: RequestLogger = {
    info: (payload, message) => {
      info.push([payload, message]);
    },
    warn: (payload, message) => {
      warn.push([payload, message]);
    },
    error: (payload, message) => {
      error.push([payload, message]);
    },
    child: () => logger,
  };
  return { info, warn, error, logger };
}
