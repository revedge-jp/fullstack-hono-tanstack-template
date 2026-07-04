import { describe, expect, test } from "bun:test";
import { createLogger } from "./create-logger.js";

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
});
