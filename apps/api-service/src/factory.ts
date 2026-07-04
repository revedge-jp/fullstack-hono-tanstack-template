import { createFactory } from "hono/factory";
import type { RequestLogger } from "./middlewares/request-logger";

type AppEnv = {
  Variables: {
    requestId: string;
    // requestLogger ミドルウェアが requestId を束ねた子ロガーを載せる。
    // ハンドラからは c.get("logger") で参照できる（ミドルウェア登録前は undefined）。
    logger?: RequestLogger;
  };
};

const factory = createFactory<AppEnv>();

export const createApp: typeof factory.createApp = factory.createApp;
