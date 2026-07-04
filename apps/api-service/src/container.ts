import { createActivityService } from "@app/features/activity/application/service";
import { createActivityRepository } from "@app/features/activity/infrastructure/activity.repository.drizzle";
import { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { makeVerifySession } from "@app/features/auth/infrastructure/session";
import { createTasksService } from "@app/features/tasks/application/service";
import { createTasksRepository } from "@app/features/tasks/infrastructure/tasks.repository.drizzle";
import { createActivityRecorder } from "@app/integrations/composition/activity-recorder";
import { createAuth } from "@app/integrations/external/auth";
import { createDevAuth, type DevAuth } from "@app/integrations/external/dev-auth";
import { createDb } from "@repo/db";
import { createLogger } from "@repo/logging";

import type { AppConfig } from "./config";

export type Container = {
  db: ReturnType<typeof createDb>["db"];
  end: () => Promise<void>;
  logger: ReturnType<typeof createLogger>;
  auth: ReturnType<typeof createAuth>;
  // 本番では未生成（nodeEnv === "production" の場合 undefined）。
  devAuth: DevAuth | undefined;
  getSession: ReturnType<typeof makeGetSession>;
  tasks: ReturnType<typeof createTasksService>;
  activity: ReturnType<typeof createActivityService>;
};

export function createContainer(config: AppConfig): Container {
  const { db, end } = createDb(config.databaseUrl);

  const logger = createLogger({
    service: "api-service",
    environment: config.nodeEnv,
    level: config.logLevel,
  });

  const auth = createAuth(config.auth, config.nodeEnv, db);
  const devAuth = config.nodeEnv !== "production" ? createDevAuth(config.auth, db) : undefined;
  const verifySession = makeVerifySession(auth, logger);
  const getSession = makeGetSession({ verifySession });

  // activity は tasks より先に組み立てる — tasks は ActivityRecorder(ports.ts)経由でのみ依存する
  const activityRepository = createActivityRepository({ db });
  const activity = createActivityService({ activityRepository });
  const activityRecorder = createActivityRecorder({ activity });

  const tasksRepository = createTasksRepository({ db });
  const tasks = createTasksService({ tasksRepository, activityRecorder, logger });

  return { db, end, logger, auth, devAuth, getSession, tasks, activity };
}
