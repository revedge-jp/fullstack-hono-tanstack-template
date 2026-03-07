import { createFactory } from "hono/factory";
import type { Env as HonoPinoEnv } from "hono-pino";

type AppEnv = HonoPinoEnv & {
  Variables: {
    requestId: string;
  };
};

const factory = createFactory<AppEnv>();

export const createApp: typeof factory.createApp = factory.createApp;
export const createMiddleware: typeof factory.createMiddleware = factory.createMiddleware;
