import { createMiddleware } from "@app/factory";
import type { Context, Next } from "hono";

export const setCacheHeaders = (cacheControl: string) =>
  createMiddleware(async (c: Context, next: Next) => {
    await next();
    if (c.req.method !== "GET") {
      return;
    }
    if (c.res.status !== 200) {
      return;
    }
    if (c.res.headers.has("Cache-Control")) {
      return;
    }
    c.header("Cache-Control", cacheControl);
    c.header("Vary", "Authorization, Accept-Encoding");
  });
