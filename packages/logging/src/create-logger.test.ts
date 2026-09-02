import { describe, expect, test } from "bun:test";

import { createLogger } from "./create-logger.js";

const originalNavigator = globalThis.navigator;

function withCloudflareWorkersRuntime<T>(run: () => T): T {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Cloudflare-Workers" },
    configurable: true,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  }
}

describe("createLogger", () => {
  test("test 環境では silent になる", () => {
    const logger = createLogger({ service: "test-service", environment: "test" });
    expect(logger.level).toBe("silent");
  });

  test("development 環境では既定で debug レベルになる", () => {
    const logger = createLogger({ service: "test-service", environment: "development" });
    expect(logger.level).toBe("debug");
  });

  test("production 環境では既定で info レベルになる", () => {
    const logger = createLogger({ service: "test-service", environment: "production" });
    expect(logger.level).toBe("info");
  });

  test("level オプションで既定レベルを上書きできる", () => {
    const logger = createLogger({
      service: "test-service",
      environment: "production",
      level: "warn",
    });
    expect(logger.level).toBe("warn");
  });

  test("child() でバインディングを継承したロガーを作れる", () => {
    const logger = createLogger({ service: "test-service", environment: "test" });
    const child = logger.child({ requestId: "abc" });
    expect(child.level).toBe("silent");
    expect(typeof child.info).toBe("function");
  });

  test("redact設定により password/cookie 等の値がログに残らない", () => {
    withCloudflareWorkersRuntime(() => {
      const logged: unknown[] = [];
      const originalConsoleLog = console.log;
      console.log = (obj: unknown) => {
        logged.push(obj);
      };
      try {
        const logger = createLogger({ service: "test-service", environment: "production" });
        logger.info({ password: "hunter2", cookie: "session=abc", userId: "user-1" }, "test");
      } finally {
        console.log = originalConsoleLog;
      }

      expect(logged.length).toBe(1);
      const entry = logged[0] as Record<string, unknown>;
      expect(entry.password).toBe("[Redacted]");
      expect(entry.cookie).toBe("[Redacted]");
      expect(entry.userId).toBe("user-1");
    });
  });

  // Cloudflare Workers Observability は `error` / `err` キーだけを $metadata.error に取り込み、
  // ダッシュボードが「Errors」として数える(本番アカウントでの実測により確定)。
  // ここでは呼び出し引数ではなく「実際に console へ出力される JSON」を検証する
  // — $metadata.error に載るかを決めるのは最終的な出力キーだから。
  describe("$metadata.error 汚染の防止", () => {
    function captureWorkersOutput(run: (logger: ReturnType<typeof createLogger>) => void): {
      warned: Record<string, unknown>[];
      errored: Record<string, unknown>[];
    } {
      return withCloudflareWorkersRuntime(() => {
        const warned: Record<string, unknown>[] = [];
        const errored: Record<string, unknown>[] = [];
        const originalWarn = console.warn;
        const originalError = console.error;
        console.warn = (obj: unknown) => {
          warned.push(obj as Record<string, unknown>);
        };
        console.error = (obj: unknown) => {
          errored.push(obj as Record<string, unknown>);
        };
        try {
          run(createLogger({ service: "test-service", environment: "production" }));
        } finally {
          console.warn = originalWarn;
          console.error = originalError;
        }
        return { warned, errored };
      });
    }

    test("warn の error キーは failure へ退避され、出力JSONに error が残らない", () => {
      const { warned } = captureWorkersOutput((logger) => {
        logger.warn({ error: "Unauthorized", status: 401 }, "request_error");
      });

      expect(warned.length).toBe(1);
      expect(warned[0]?.error).toBeUndefined();
      expect(warned[0]?.failure).toEqual({ error: "Unauthorized" });
      expect(warned[0]?.status).toBe(401);
    });

    test("warn の err キーも退避される(pino既定のエラーキーであり自然に使われるため)", () => {
      const { warned } = captureWorkersOutput((logger) => {
        logger.warn({ err: "Unexpected" }, "fail-open");
      });

      expect(warned[0]?.err).toBeUndefined();
      expect(warned[0]?.failure).toEqual({ err: "Unexpected" });
    });

    test("warn で Error を渡してもスタックを保ったまま退避される", () => {
      const { warned } = captureWorkersOutput((logger) => {
        logger.warn({ err: new Error("boom") }, "fail-open");
      });

      expect(warned[0]?.err).toBeUndefined();
      const failure = warned[0]?.failure as {
        err: { type: string; message: string; stack: string };
      };
      expect(failure.err.type).toBe("Error");
      expect(failure.err.message).toBe("boom");
      expect(failure.err.stack).toContain("boom");
    });

    test("error レベルは退避しない(5xx・未捕捉例外は $metadata.error に載って検知されるべき)", () => {
      const { errored } = captureWorkersOutput((logger) => {
        logger.error({ error: "Unexpected", status: 500 }, "request_error");
      });

      expect(errored[0]?.error).toBe("Unexpected");
      expect(errored[0]?.failure).toBeUndefined();
    });

    test("退避先キーが既に使われていても呼び出し側の値を落とさない", () => {
      const { warned } = captureWorkersOutput((logger) => {
        logger.warn({ failure: "caller-value", err: "Unexpected" }, "fail-open");
      });

      expect(warned[0]?.err).toBeUndefined();
      expect(warned[0]?.failure).toEqual({ original: "caller-value", err: "Unexpected" });
    });

    test("error と err が同時にある場合は両方まとめて退避される", () => {
      const { warned } = captureWorkersOutput((logger) => {
        logger.warn({ error: "A", err: "B" }, "fail-open");
      });

      expect(warned[0]?.error).toBeUndefined();
      expect(warned[0]?.err).toBeUndefined();
      expect(warned[0]?.failure).toEqual({ error: "A", err: "B" });
    });

    test("info(console.log 経路)も退避される — アクセスログが通るのはこの分岐", () => {
      // write() は level ごとに console.error / warn / log の3分岐を持ち、warn と log は
      // それぞれ独立に退避を呼んでいる。log 側だけ退避が外れる回帰を検出する。
      const logged: Record<string, unknown>[] = [];
      const originalLog = console.log;
      withCloudflareWorkersRuntime(() => {
        console.log = (obj: unknown) => {
          logged.push(obj as Record<string, unknown>);
        };
        try {
          createLogger({ service: "test-service", environment: "production" }).info(
            { err: "Unexpected", path: "/api/shops" },
            "request",
          );
        } finally {
          console.log = originalLog;
        }
      });

      expect(logged[0]?.err).toBeUndefined();
      expect(logged[0]?.failure).toEqual({ err: "Unexpected" });
      expect(logged[0]?.path).toBe("/api/shops");
    });

    test("error/err を含まない warn はそのまま出力される", () => {
      const { warned } = captureWorkersOutput((logger) => {
        logger.warn({ errorCode: "NotFound", status: 404 }, "request_error");
      });

      expect(warned[0]?.errorCode).toBe("NotFound");
      expect(warned[0]?.failure).toBeUndefined();
    });
  });
});
