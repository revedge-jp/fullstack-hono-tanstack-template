import { describe, expect, test } from "bun:test";

import { loadConfig } from "./config";

// loadConfig は { ...process.env, ...env } をマージするため、テスト（bun は .env を
// 自動ロードする）では欠落を「キー削除」ではなく「undefined を明示」で表現する。
// そうしないと .env の値が漏れ込んでしまう。
type EnvOverride = Record<string, string | undefined>;

// production で必須になる変数を満たした最小の env セット。個別テストで一部を undefined にする。
const prodEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
  BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  CORS_ORIGIN: "https://app.example.com",
} satisfies EnvOverride;

// development は必須変数が緩い。.env 由来の BETTER_AUTH_URL 等は明示的に打ち消す。
const devEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "short-secret",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  BETTER_AUTH_URL: undefined,
  BETTER_AUTH_TRUSTED_ORIGINS: undefined,
  CORS_ORIGIN: undefined,
  API_PORT: undefined,
  PORT: undefined,
  APP_VERSION: undefined,
  GIT_SHA: undefined,
  INFRA_SHA: undefined,
} satisfies EnvOverride;

describe("loadConfig — production 必須検証", () => {
  test("すべて揃っていれば読み込める", () => {
    const config = loadConfig(prodEnv);
    expect(config.nodeEnv).toBe("production");
    expect(config.corsOrigin).toBe("https://app.example.com");
    expect(config.auth.trustedOrigins).toEqual(["https://app.example.com"]);
  });

  test("BETTER_AUTH_SECRET が 32 文字未満だと throw", () => {
    expect(() => loadConfig({ ...prodEnv, BETTER_AUTH_SECRET: "x".repeat(31) })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("BETTER_AUTH_URL 欠落だと throw", () => {
    expect(() => loadConfig({ ...prodEnv, BETTER_AUTH_URL: undefined })).toThrow(/BETTER_AUTH_URL/);
  });

  test("CORS_ORIGIN 欠落だと throw", () => {
    expect(() => loadConfig({ ...prodEnv, CORS_ORIGIN: undefined })).toThrow(
      /CORS_ORIGIN is required in production/,
    );
  });

  // fail-closed: NODE_ENV 未設定はサイレントに development へ倒さず production として扱う。
  // dev-auth 有効化・secure cookie 無効・CORS localhost 許可が「注入忘れ」だけで
  // 同時成立する構造を塞ぐ。
  test("NODE_ENV 未設定は production として扱われる", () => {
    const config = loadConfig({ ...prodEnv, NODE_ENV: undefined });
    expect(config.nodeEnv).toBe("production");
    expect(() => loadConfig({ ...prodEnv, NODE_ENV: undefined, CORS_ORIGIN: undefined })).toThrow(
      /CORS_ORIGIN is required in production/,
    );
  });

  test("TRUSTED_ORIGINS 欠落でも BETTER_AUTH_URL から導出される", () => {
    const config = loadConfig({ ...prodEnv, BETTER_AUTH_TRUSTED_ORIGINS: undefined });
    expect(config.auth.trustedOrigins).toEqual(["https://app.example.com"]);
  });
});

describe("loadConfig — development の緩さ", () => {
  test("短い secret でも throw せず、CORS はローカル既定にフォールバック", () => {
    const config = loadConfig(devEnv);
    expect(config.auth.secret).toBe("short-secret");
    expect(config.corsOrigin).toBe("http://localhost:3000");
  });
});

describe("loadConfig — ポート解決（API_PORT が PORT より優先）", () => {
  test("API_PORT を優先", () => {
    expect(loadConfig({ ...devEnv, API_PORT: "1111", PORT: "2222" }).port).toBe(1111);
  });

  test("API_PORT 未設定なら PORT を使う", () => {
    expect(loadConfig({ ...devEnv, PORT: "2222" }).port).toBe(2222);
  });

  test("どちらも未設定なら 8080", () => {
    expect(loadConfig(devEnv).port).toBe(8080);
  });
});

describe("loadConfig — trustedOrigins の CSV パース", () => {
  test("カンマ区切りを trim・空要素除去してパース", () => {
    const config = loadConfig({
      ...devEnv,
      BETTER_AUTH_TRUSTED_ORIGINS: " https://a.example.com , , https://b.example.com ",
    });
    expect(config.auth.trustedOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  test("未設定なら空配列（development）", () => {
    expect(loadConfig(devEnv).auth.trustedOrigins).toEqual([]);
  });
});

describe("loadConfig — 新規フィールドの既定値", () => {
  test("timeout / rateLimit / version の既定", () => {
    const config = loadConfig(devEnv);
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.rateLimit).toEqual({ windowMs: 60_000, max: 20 });
    expect(config.version).toEqual({ appVersion: "dev", gitSha: "dev", infraSha: "dev" });
  });

  test("APP_VERSION / GIT_SHA を注入できる", () => {
    const config = loadConfig({ ...devEnv, APP_VERSION: "1.2.3", GIT_SHA: "abc1234" });
    // INFRA_SHA が無ければ GIT_SHA と同じ（通常のデプロイはアプリとインフラが同じ commit）
    expect(config.version).toEqual({ appVersion: "1.2.3", gitSha: "abc1234", infraSha: "abc1234" });
  });

  test("INFRA_SHA は GIT_SHA と別に注入できる（自動ロールバック後はアプリだけが古い）", () => {
    const config = loadConfig({ ...devEnv, GIT_SHA: "aaa", INFRA_SHA: "bbb" });
    expect(config.version.infraSha).toBe("bbb");
  });
});

describe("loadConfig — 空文字 env（CI の未設定 GitHub Variable）を安全に扱う", () => {
  test("数値 env が空文字なら throw せず既定値にフォールバックする", () => {
    const config = loadConfig({
      ...devEnv,
      REQUEST_TIMEOUT_MS: "",
      RATE_LIMIT_WINDOW_MS: "",
      RATE_LIMIT_MAX: "",
    });
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.rateLimit).toEqual({ windowMs: 60_000, max: 20 });
  });

  test("数値 env が不正文字列なら throw する（空文字とは区別する）", () => {
    expect(() => loadConfig({ ...devEnv, REQUEST_TIMEOUT_MS: "abc" })).toThrow(
      /REQUEST_TIMEOUT_MS/,
    );
  });

  test("APP_VERSION / GIT_SHA が空文字なら dev にフォールバックする", () => {
    const config = loadConfig({ ...devEnv, APP_VERSION: "", GIT_SHA: "   " });
    expect(config.version).toEqual({ appVersion: "dev", gitSha: "dev", infraSha: "dev" });
  });

  test("ポートが空文字なら未設定として扱い、もう片方か 8080 を使う（0 で起動しない）", () => {
    expect(loadConfig({ ...devEnv, API_PORT: "", PORT: "" }).port).toBe(8080);
    expect(loadConfig({ ...devEnv, API_PORT: "", PORT: "3001" }).port).toBe(3001);
  });

  test("CORS_ORIGIN が空文字なら、本番は必須検証で止まり、開発はローカル既定を使う", () => {
    expect(() => loadConfig({ ...prodEnv, CORS_ORIGIN: "" })).toThrow(
      /CORS_ORIGIN is required in production/,
    );
    expect(loadConfig({ ...devEnv, CORS_ORIGIN: "" }).corsOrigin).toBe("http://localhost:3000");
  });

  test("BETTER_AUTH_URL / BETTER_AUTH_TRUSTED_ORIGINS が空文字なら未設定と同じ", () => {
    expect(() => loadConfig({ ...prodEnv, BETTER_AUTH_URL: "" })).toThrow(/BETTER_AUTH_URL/);
    const config = loadConfig({ ...prodEnv, BETTER_AUTH_TRUSTED_ORIGINS: "" });
    expect(config.auth.trustedOrigins).toEqual(["https://app.example.com"]);
  });
});
