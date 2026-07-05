import { createApp as createHonoApp } from "@app/factory";
import type { ActivityService } from "@app/features/activity/application/service";
import { createActivityRouter } from "@app/features/activity/presentation";
import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { createAuthRouter } from "@app/features/auth/presentation";
import type { TasksService } from "@app/features/tasks/application/service";
import { createTasksRouter } from "@app/features/tasks/presentation";
import type { DevAuth } from "@app/integrations/external/dev-auth";
import { createDevAuthRouter } from "@app/routes/dev-auth";
import { stringifyErrorSafe } from "@repo/logging";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { timing } from "hono/timing";

import { type AppConfig, loadConfig } from "./config";
import { createContainer } from "./container";
import { rateLimit } from "./middlewares/rate-limit";
import { type RequestLogger, requestLogger } from "./middlewares/request-logger";
import { createHealthRouter, type HealthDb } from "./routes/health";

// buildApp が実行時に必要とする依存の構造的な型。本番の Container はこれに代入可能で、
// テストの createFakeApp はこの形の fake を渡すことで「本物のミドルウェアスタック」を
// そのまま通せる（app.ts の配線を一箇所に保つ）。
export type AppRuntime = {
  db: HealthDb;
  logger: RequestLogger;
  auth: { handler: (req: Request) => Response | Promise<Response> };
  devAuth: DevAuth | undefined;
  getSession: ReturnType<typeof makeGetSession>;
  tasks: TasksService;
  activity: ActivityService;
};

type BuildConfig = Pick<
  AppConfig,
  "nodeEnv" | "corsOrigin" | "requestTimeoutMs" | "rateLimit" | "version"
>;

// ミドルウェアスタック + ルーティングの唯一の組み立て箇所。createApp（本番）と
// createFakeApp（テスト）の両方がここを共有する。
export function buildApp(config: BuildConfig, runtime: AppRuntime) {
  const app = createHonoApp();
  app.use(
    "*",
    requestId({
      headerName: "x-request-id",
    }),
  );
  // requestId を束ねた pino 子ロガーによる構造化アクセスログ（hono/logger の置き換え）。
  // ハンドラからは c.get("logger") でリクエスト相関つきロガーを参照できる。
  app.use("*", requestLogger(runtime.logger));
  app.use("*", timing());
  // ハングしたハンドラが接続を占有し続けないよう上限を課す。超過時は HTTPException(504) を
  // 投げるので、下の onError が HTTPException をそのまま返せるようにしておくこと。
  app.use("*", timeout(config.requestTimeoutMs));
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: config.corsOrigin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-request-id"],
      exposeHeaders: ["x-request-id"],
      maxAge: 600,
      credentials: true,
    }),
  );
  // JSON API のためボディは 1MiB で十分。巨大ボディによるメモリ圧迫を防ぐ。
  app.use(
    "*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ ok: false, error: "Payload Too Large" }, 413),
    }),
  );
  if (config.nodeEnv !== "production") {
    app.use("*", prettyJSON());
  }
  // OAuth エンドポイントは資格情報の総当たりや過剰アクセスの標的になりやすいため、
  // Better Auth ハンドラの手前でレート制限をかける。制限値は config 経由（DI）で渡す。
  app.use(
    "/api/auth/*",
    rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max }),
  );
  app.on(["GET", "POST", "PUT", "PATCH", "DELETE"], "/api/auth/**", (c) =>
    runtime.auth.handler(c.req.raw),
  );

  const routes = app
    .route("/api/health", createHealthRouter({ db: runtime.db, info: toHealthInfo(config) }))
    .route("/api", createAuthRouter({ getSession: runtime.getSession }))
    .route(
      "/api/tasks",
      createTasksRouter({ tasks: runtime.tasks, getSession: runtime.getSession }),
    )
    .route(
      "/api/activities",
      createActivityRouter({ activity: runtime.activity, getSession: runtime.getSession }),
    )
    .route("/api/dev", createDevAuthRouter({ devAuth: runtime.devAuth }))
    .get("/", (c) => c.json({ ok: true, message: "Hello Server!" }))
    .notFound((c) => c.json({ ok: false, error: "Not Found" }, 404))
    .onError((err, c) => {
      // timeout / bodyLimit などが投げる HTTPException は、その意図した
      // ステータス・レスポンスをそのまま返す（500 に握り潰さない）。
      if (err instanceof HTTPException) {
        return err.getResponse();
      }

      const rid = c.get("requestId");
      const message = stringifyErrorSafe(err);

      // requestLogger ミドルウェアより前で落ちた場合に備え、runtime.logger にフォールバック
      const log = c.get("logger") ?? runtime.logger;
      log.error(
        {
          requestId: rid,
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          err: message,
        },
        "unhandled error",
      );

      if (config.nodeEnv !== "production") {
        const stack = err instanceof Error ? err.stack : undefined;
        const detail = stack ?? message;
        return c.json(
          {
            ok: false,
            error: "Internal Server Error",
            requestId: rid,
            detail,
          },
          500,
        );
      }
      return c.json({ ok: false, error: "Internal Server Error", requestId: rid }, 500);
    });

  return routes;
}

function toHealthInfo(config: BuildConfig) {
  return { version: config.version.appVersion, commit: config.version.gitSha };
}

export function createApp(env?: Record<string, string | undefined>) {
  const config = loadConfig(env);
  const container = createContainer(config);
  const app = buildApp(config, container);
  return { app, auth: container.auth, end: container.end, container };
}

// AppType is the Hono routes type used for RPC client generation.
export type AppType = ReturnType<typeof createApp>["app"];
