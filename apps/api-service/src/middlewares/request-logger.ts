import { createMiddleware } from "hono/factory";

// pino.Logger に構造的に一致する最小型。ミドルウェア層を pino の型に直接依存させない。
export type RequestLogger = {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): RequestLogger;
};

type Env = {
  Variables: {
    requestId: string;
    logger?: RequestLogger;
  };
};

/**
 * requestId を束ねた子ロガーを context に載せ、アクセスログを構造化して出力する。
 * ハンドラからは `c.get("logger")` でリクエスト相関つきロガーが使える。
 * requestId ミドルウェアより後に登録すること。
 */
export function requestLogger(baseLogger: RequestLogger) {
  return createMiddleware<Env>(async (c, next) => {
    const log = baseLogger.child({ requestId: c.get("requestId") });
    c.set("logger", log);
    const start = performance.now();
    await next();
    log.info(
      {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request",
    );
  });
}
