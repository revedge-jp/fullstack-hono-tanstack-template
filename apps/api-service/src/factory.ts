import { createFactory } from "hono/factory";

import type { AuthUser } from "./features/auth/domain/models";
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

// requireAuth ミドルウェア適用済みのルーター用。user が non-null で型付けされる代わりに、
// 先頭で `.use(requireAuth(...))` を登録することが前提（登録漏れは実行時 undefined になる）。
type AuthedAppEnv = {
  Variables: AppEnv["Variables"] & {
    user: AuthUser;
  };
};

const authedFactory = createFactory<AuthedAppEnv>();

export const createAuthedApp: typeof authedFactory.createApp = authedFactory.createApp;
