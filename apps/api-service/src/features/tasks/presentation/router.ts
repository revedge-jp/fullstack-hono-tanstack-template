import { createAuthedApp } from "@app/factory";
import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { requireAuth } from "@app/middlewares/require-auth";
import { toEmptyHttp, toHttp } from "@app/shared/http/to-http";
import { zValidator } from "@app/shared/http/z-validator";
import { z } from "zod";

import type { TasksService } from "../application/service";

const CreateTaskRequestSchema = z.object({ title: z.string().min(1).max(200) });

// cursor の中身（形式・整合性）の検証は application 層の validators が担う。
// ここでは HTTP クエリとしての形（型・範囲）だけをチェックする。
const ListTasksQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// tasks.id は uuid カラムのため、非 UUID 文字列をそのままリポジトリに渡すと
// PostgreSQL の 22P02（invalid_text_representation）→ "Unexpected"（500）になってしまう。
// UUID 形式でない id は「存在し得ない ID」なので、DB に触れる前に 404 として扱う。
const TaskIdParamSchema = z.object({ id: z.uuid() });
const taskIdParam = zValidator("param", TaskIdParamSchema, (result, c) => {
  if (!result.success) {
    return c.json({ ok: false, error: "NotFound" }, 404);
  }
});

export function createTasksRouter(deps: {
  tasks: TasksService;
  getSession: ReturnType<typeof makeGetSession>;
}) {
  return createAuthedApp()
    .use(requireAuth(deps.getSession))
    .post("/", zValidator("json", CreateTaskRequestSchema), async (c) => {
      const body = c.req.valid("json");
      const result = await deps.tasks.createTask({
        ownerId: c.get("user").id,
        title: body.title,
      });
      return toHttp(c, result, { Invalid: 400, Conflict: 409, Unexpected: 500 }, 201);
    })
    .get("/", zValidator("query", ListTasksQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const result = await deps.tasks.listTasks({
        ownerId: c.get("user").id,
        cursor: query.cursor,
        limit: query.limit,
      });
      return toHttp(c, result, { Invalid: 400, Unexpected: 500 });
    })
    .get("/:id", taskIdParam, async (c) => {
      const result = await deps.tasks.getTask({
        id: c.req.valid("param").id,
        ownerId: c.get("user").id,
      });
      return toHttp(c, result, { NotFound: 404, Unexpected: 500 });
    })
    .patch("/:id", taskIdParam, async (c) => {
      const result = await deps.tasks.advanceTask({
        id: c.req.valid("param").id,
        ownerId: c.get("user").id,
      });
      return toHttp(c, result, { AlreadyDone: 409, NotFound: 404, Unexpected: 500 });
    })
    .delete("/:id", taskIdParam, async (c) => {
      const result = await deps.tasks.deleteTask({
        id: c.req.valid("param").id,
        ownerId: c.get("user").id,
      });
      return toEmptyHttp(c, result, { NotFound: 404, Unexpected: 500 });
    });
}
