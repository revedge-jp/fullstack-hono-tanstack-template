import { z } from "zod";

// 本番で BETTER_AUTH_SECRET に要求する最小長。Better Auth は HMAC 署名に使うため、
// 十分なエントロピー（32 文字以上）を要求する。開発では .env.example のプレースホルダ
// （"your-secret-here" = 16 文字）で動くよう緩める。
const MIN_SECRET_LENGTH = 32;

// 空文字を undefined として扱い、default を効かせるための数値 env スキーマ。
// このリポジトリでは未設定の GitHub Variable が CI から "" として渡ってくる（alchemy.run.ts の
// `|| :` 参照）。素の z.coerce.number() は "" を 0 に変換し .positive() で失敗するため、
// 起動時に loadConfig が throw してしまう。"" は「未設定」とみなして default にフォールバックする。
const numberEnv = (defaultValue: number) =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().default(defaultValue),
  );

const ConfigSchema = z
  .object({
    // 既定は production(fail-closed)。development に倒すと、デプロイ経路で NODE_ENV の
    // 注入を忘れたとき、エラーなく dev-auth(/api/dev/login)が有効・cookie の secure 無し・
    // CORS localhost 許可の状態で起動しうる。production に倒せば未設定時は CORS_ORIGIN 等の
    // 必須検証で起動時に fail-fast する(ローカル開発は .env の NODE_ENV=development で明示)。
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    LOG_PRETTY: z.string().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    CORS_ORIGIN: z.string().optional(),
    API_PORT: z.coerce.number().optional(),
    PORT: z.coerce.number().optional(),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    // リクエストタイムアウト（ミリ秒）。ハングしたハンドラが接続を占有し続けるのを防ぐ。
    REQUEST_TIMEOUT_MS: numberEnv(30_000),
    // 認証エンドポイント（OAuth）向けレート制限。per-isolate のメモリストアで数える
    // （middlewares/rate-limit.ts 参照）。ウィンドウ長とウィンドウあたりの最大許容数。
    RATE_LIMIT_WINDOW_MS: numberEnv(60_000),
    RATE_LIMIT_MAX: numberEnv(20),
    // health エンドポイントで返すビルド識別子。デプロイ時に注入する（未注入なら "dev"）。
    APP_VERSION: z.string().optional(),
    GIT_SHA: z.string().optional(),
  })
  .refine((v) => v.NODE_ENV !== "production" || v.BETTER_AUTH_SECRET.length >= MIN_SECRET_LENGTH, {
    path: ["BETTER_AUTH_SECRET"],
    message: `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`,
  })
  .refine((v) => v.NODE_ENV !== "production" || Boolean(v.BETTER_AUTH_URL), {
    path: ["BETTER_AUTH_URL"],
    message: "BETTER_AUTH_URL is required in production",
  });

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  logPretty?: string;
  logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigin: string;
  port: number;
  requestTimeoutMs: number;
  rateLimit: {
    windowMs: number;
    max: number;
  };
  version: {
    appVersion: string;
    gitSha: string;
  };
  databaseUrl: string;
  auth: {
    secret: string;
    baseURL?: string;
    trustedOrigins: string[];
    googleClientId: string;
    googleClientSecret: string;
  };
};

export function loadConfig(env?: Record<string, string | undefined>): AppConfig {
  const source = env ? { ...process.env, ...env } : process.env;
  const parsed = ConfigSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables: ${JSON.stringify(z.treeifyError(parsed.error).properties)}`,
    );
  }
  const base = parsed.data;
  const isProduction = base.NODE_ENV === "production";

  const corsOrigin = base.CORS_ORIGIN ?? (isProduction ? undefined : "http://localhost:3000");
  if (corsOrigin === undefined) {
    throw new Error("CORS_ORIGIN is required in production");
  }

  const explicitTrustedOrigins =
    base.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  // 本番では信頼オリジンを必須にする（CORS_ORIGIN と同じ扱い）。デプロイ側が
  // BETTER_AUTH_TRUSTED_ORIGINS を注入しない場合でも BETTER_AUTH_URL（本番必須）から
  // 導出してフォールバックする。どちらも無ければ fail-fast する。
  const trustedOrigins =
    explicitTrustedOrigins.length > 0
      ? explicitTrustedOrigins
      : isProduction && base.BETTER_AUTH_URL
        ? [base.BETTER_AUTH_URL]
        : explicitTrustedOrigins;
  if (isProduction && trustedOrigins.length === 0) {
    throw new Error(
      "BETTER_AUTH_TRUSTED_ORIGINS is required in production (or set BETTER_AUTH_URL to derive it)",
    );
  }

  return {
    nodeEnv: base.NODE_ENV,
    logPretty: base.LOG_PRETTY,
    logLevel: base.LOG_LEVEL,
    corsOrigin,
    port: base.API_PORT ?? base.PORT ?? 8080,
    requestTimeoutMs: base.REQUEST_TIMEOUT_MS,
    rateLimit: {
      windowMs: base.RATE_LIMIT_WINDOW_MS,
      max: base.RATE_LIMIT_MAX,
    },
    version: {
      // `??` ではなく `|| "dev"`: 空文字（未設定の GitHub Variable が "" で来るケース）も
      // 未設定とみなして "dev" にフォールバックする。trim で空白のみも同様に扱う。
      appVersion: base.APP_VERSION?.trim() || "dev",
      gitSha: base.GIT_SHA?.trim() || "dev",
    },
    databaseUrl: base.DATABASE_URL,
    auth: {
      secret: base.BETTER_AUTH_SECRET,
      baseURL: base.BETTER_AUTH_URL,
      trustedOrigins,
      googleClientId: base.GOOGLE_CLIENT_ID,
      googleClientSecret: base.GOOGLE_CLIENT_SECRET,
    },
  };
}
