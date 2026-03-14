import { createFactory } from "hono/factory";

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

const factory = createFactory<AppEnv>();

export const createApp: typeof factory.createApp = factory.createApp;
