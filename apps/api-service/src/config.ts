import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  logPretty?: string;
  logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigin: string;
  port: number;
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

  const corsOrigin =
    base.CORS_ORIGIN ?? (base.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (corsOrigin === undefined) {
    throw new Error("CORS_ORIGIN is required in production");
  }

  return {
    nodeEnv: base.NODE_ENV,
    logPretty: base.LOG_PRETTY,
    logLevel: base.LOG_LEVEL,
    corsOrigin,
    port: base.API_PORT ?? base.PORT ?? 8080,
    databaseUrl: base.DATABASE_URL,
    auth: {
      secret: base.BETTER_AUTH_SECRET,
      baseURL: base.BETTER_AUTH_URL,
      trustedOrigins:
        base.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
      googleClientId: base.GOOGLE_CLIENT_ID,
      googleClientSecret: base.GOOGLE_CLIENT_SECRET,
    },
  };
}
