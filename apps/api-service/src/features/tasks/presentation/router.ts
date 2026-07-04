import { createApp } from "@app/factory";
import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import type { AuthUser } from "@app/features/auth/domain/models";
import { toHttp } from "@app/shared/http/to-http";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { err } from "neverthrow";
import { z } from "zod";
import type { TasksService } from "../application/service";

const CreateTaskRequestSchema = z.object({ title: z.string().min(1).max(200) });

async function requireUser(
  c: Context,
  getSession: ReturnType<typeof makeGetSession>,
): Promise<AuthUser | Response> {
  const session = await getSession(c.req.raw);
  if (session.isErr()) {
    return toHttp(c, err(session.error), { Unauthorized: 401, Unexpected: 500 });
  }
  return session.value;
}

export function createTasksRouter(deps: {
  tasks: TasksService;
  getSession: ReturnType<typeof makeGetSession>;
}) {
  return createApp()
    .post("/", zValidator("json", CreateTaskRequestSchema), async (c) => {
      const user = await requireUser(c, deps.getSession);
      if (user instanceof Response) {
        return user;
      }
      const body = c.req.valid("json");
      const result = await deps.tasks.createTask({ ownerId: user.id, title: body.title });
      return toHttp(c, result, { Invalid: 400, Conflict: 409, Unexpected: 500 }, 201);
    })
    .get("/", async (c) => {
      const user = await requireUser(c, deps.getSession);
      if (user instanceof Response) {
        return user;
      }
      const result = await deps.tasks.listTasks({ ownerId: user.id });
      return toHttp(c, result, { Unexpected: 500 });
    })
    .get("/:id", async (c) => {
      const user = await requireUser(c, deps.getSession);
      if (user instanceof Response) {
        return user;
      }
      const result = await deps.tasks.getTask({ id: c.req.param("id"), ownerId: user.id });
      return toHttp(c, result, { NotFound: 404, Unexpected: 500 });
    })
    .patch("/:id", async (c) => {
      const user = await requireUser(c, deps.getSession);
      if (user instanceof Response) {
        return user;
      }
      const result = await deps.tasks.advanceTask({ id: c.req.param("id"), ownerId: user.id });
      return toHttp(c, result, { AlreadyDone: 409, NotFound: 404, Unexpected: 500 });
    })
    .delete("/:id", async (c) => {
      const user = await requireUser(c, deps.getSession);
      if (user instanceof Response) {
        return user;
      }
      const result = await deps.tasks.deleteTask({ id: c.req.param("id"), ownerId: user.id });
      if (result.isOk()) {
        return c.body(null, 204);
      }
      return toHttp(c, result, { NotFound: 404, Unexpected: 500 });
    });
}
