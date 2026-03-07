import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_BASE_URL: z.string().optional(),
});

type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  apiBaseUrl: string;
};

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) {
    return cached;
  }

  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const base = parsed.data;

  cached = {
    nodeEnv: base.NODE_ENV,
    apiBaseUrl: base.API_BASE_URL ?? "http://localhost:8080",
  };
  return cached;
}
