import { prisma as prismaClient } from "@repo/db";
import { createLogger } from "@repo/logging";
import type { AppConfig } from "./config";
import { createUsersService } from "./features/users/application/service";
import { createUsersRepository } from "./features/users/infrastructure/users.repository.prisma";

export function createContainer(config: AppConfig) {
  const prisma = prismaClient;

  const logger = createLogger({
    service: "api-service",
    environment: config.nodeEnv,
    level: config.logLevel,
  });

  const usersRepository = createUsersRepository({ prisma });
  const users = createUsersService({ usersRepository });

  return { prisma, logger, users };
}
