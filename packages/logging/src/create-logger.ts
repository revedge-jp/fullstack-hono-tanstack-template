import { createGcpLoggingPinoConfig } from "@google-cloud/pino-logging-gcp-config";
import pino from "pino";

export type CreateLoggerOptions = {
  service: string;
  version?: string;
  level?: string;
  environment?: string;
};

export function createLogger(options: CreateLoggerOptions) {
  const { service, version, level, environment } = options;

  if (environment === "development") {
    return pino({
      level: level ?? "debug",
      transport: { target: "pino-pretty" },
    });
  }

  if (environment === "test") {
    return pino({ level: "silent" });
  }

  return pino(
    createGcpLoggingPinoConfig(
      { serviceContext: { service, version } },
      { level: level ?? "info" },
    ),
  );
}
