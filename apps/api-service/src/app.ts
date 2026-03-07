import { createApp as createHonoApp } from "@app/factory";
import { createUsersRouter } from "@features/users/presentation";
import { stringifyErrorSafe } from "@repo/logging";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { pinoLogger } from "hono-pino";
import { loadConfig } from "./config";
import { createContainer } from "./container";
import { setCacheHeaders } from "./middlewares/cache";
import { createHealthRouter } from "./routes/health";

export function createApp() {
  const app = createHonoApp();
  const config = loadConfig();
  const container = createContainer(config);

  app.use(
    "*",
    requestId({
      headerName: "x-request-id",
    }),
  );
  app.route("/api/health", createHealthRouter({ prisma: container.prisma }));
  app.use(
    "*",
    pinoLogger({
      pino: container.logger,
      http: {
        referRequestIdKey: "requestId",
        onReqBindings: (c) => ({
          req: { url: c.req.path, method: c.req.method },
        }),
        onResBindings: (c) => ({
          res: { status: c.res.status },
        }),
      },
    }),
  );
  app.use("*", async (c, next) => {
    const traceHeader = c.req.header("x-cloud-trace-context");
    if (traceHeader) {
      const [traceId] = traceHeader.split("/");
      c.var.logger.assign({
        "logging.googleapis.com/trace": `projects/${config.googleCloudProject}/traces/${traceId}`,
      });
    }
    await next();
  });
  if (config.logPretty === "true") {
    app.use("*", logger());
  }
  app.use("*", timing());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: config.corsOrigin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-request-id"],
      exposeHeaders: ["ETag", "x-request-id"],
      maxAge: 600,
      credentials: true,
    }),
  );
  if (config.nodeEnv !== "production") {
    app.use("*", prettyJSON());
  }
  app.use("*", etag());
  app.use("*", setCacheHeaders("private, max-age=60"));

  const apiRoutes = createHonoApp().route("/users", createUsersRouter(container));

  const routes = app
    .route("/api", apiRoutes)
    .get("/", (c) => c.json({ ok: true, message: "Hello Server!" }))
    .notFound((c) => c.json({ ok: false, error: "Not Found" }, 404))
    .onError((err, c) => {
      const rid = c.get("requestId");
      const message = stringifyErrorSafe(err);

      const log = c.var?.logger;
      if (log) {
        log.error(
          {
            err,
            requestId: rid,
            method: c.req.method,
            path: new URL(c.req.url).pathname,
          },
          "Unhandled error: %s",
          message,
        );
      } else {
        console.error("Unhandled error (logger unavailable):", message);
      }

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

export type AppType = ReturnType<typeof createApp>;
