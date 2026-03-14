import { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { makeVerifySession } from "@app/features/auth/infrastructure/session";
import { createAuth } from "@app/integrations/auth";
import { createDb } from "@repo/db";
import { createLogger } from "@repo/logging";
import type { AppConfig } from "./config";

export function createContainer(config: AppConfig) {
  const { db, end } = createDb(config.databaseUrl);

  const logger = createLogger({
    service: "api-service",
    environment: config.nodeEnv,
    level: config.logLevel,
  });

  const auth = createAuth(config.auth, config.nodeEnv, db);
  const verifySession = makeVerifySession(auth, logger);
  const getSession = makeGetSession({ verifySession });

  return { db, end, logger, auth, getSession };
}
