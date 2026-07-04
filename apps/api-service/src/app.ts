import { createApp as createHonoApp } from "@app/factory";
import { createActivityRouter } from "@app/features/activity/presentation/router";
import { createAuthRouter } from "@app/features/auth/presentation/router";
import { createTasksRouter } from "@app/features/tasks/presentation/router";
import { stringifyErrorSafe } from "@repo/logging";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { loadConfig } from "./config";
import { createContainer } from "./container";
import { createHealthRouter } from "./routes/health";

export function createApp(env?: Record<string, string | undefined>) {
  const app = createHonoApp();
  const config = loadConfig(env);
  const container = createContainer(config);
  app.use(
    "*",
    requestId({
      headerName: "x-request-id",
    }),
  );
  app.use("*", logger());
  app.use("*", timing());
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
  if (config.nodeEnv !== "production") {
    app.use("*", prettyJSON());
  }
  app.on(["GET", "POST", "PUT", "PATCH", "DELETE"], "/api/auth/**", (c) =>
    container.auth.handler(c.req.raw),
  );

  const routes = app
    .route("/api/health", createHealthRouter({ db: container.db }))
    .route("/api", createAuthRouter({ getSession: container.getSession }))
    .route(
      "/api/tasks",
      createTasksRouter({ tasks: container.tasks, getSession: container.getSession }),
    )
    .route("/api/activities", createActivityRouter({ activity: container.activity }))
    .get("/", (c) => c.json({ ok: true, message: "Hello Server!" }))
    .notFound((c) => c.json({ ok: false, error: "Not Found" }, 404))
    .onError((err, c) => {
      const rid = c.get("requestId");
      const message = stringifyErrorSafe(err);

      console.error("[unhandled]", {
        requestId: rid,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        err,
      });

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

  return { app: routes, auth: container.auth, end: container.end, container };
}

// AppType is the Hono routes type used for RPC client generation.
export type AppType = ReturnType<typeof createApp>["app"];
