import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_PRETTY: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  CORS_ORIGIN: z.string().optional(),
  API_PORT: z.coerce.number().optional(),
  PORT: z.coerce.number().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().default("kikagaku"),
  PREFIX: z.string().default("local"),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  logPretty?: string;
  logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigin: string;
  port: number;
  googleCloudProject: string;
  prefix: string;
};

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    process.exit(1);
  }
  const base = parsed.data;

  const corsOrigin =
    base.CORS_ORIGIN ?? (base.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (corsOrigin === undefined) {
    console.error("CORS_ORIGIN is required in production");
    process.exit(1);
  }

  return {
    nodeEnv: base.NODE_ENV,
    logPretty: base.LOG_PRETTY,
    logLevel: base.LOG_LEVEL,
    corsOrigin,
    port: base.API_PORT ?? base.PORT ?? 8080,
    googleCloudProject: base.GOOGLE_CLOUD_PROJECT,
    prefix: base.PREFIX,
  };
}
