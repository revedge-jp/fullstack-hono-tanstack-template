import type { UsersService } from "@features/users/application/service";
import { zValidator } from "@hono/zod-validator";
import { isOk } from "@repo/result";
import { Hono } from "hono";
import { z } from "zod";

const CreateUserRequestSchema = z.object({
  email: z.email(),
  name: z.string().nullable(),
});

const UpdateUserRequestSchema = z.object({
  name: z.string().nullable(),
});

const uuidParamSchema = z.object({ id: z.string().uuid() }).strict();

export function createUsersRouter(cntr: { users: UsersService }) {
  const app = new Hono()
    .get("/", async (c) => {
      const result = await cntr.users.listUsers();
      if (!isOk(result)) {
        return c.json({ message: "unexpected" }, 500);
      }
      return c.json(result.value, 200);
    })
    .post(
      "/",
      zValidator("json", CreateUserRequestSchema, (result, c) => {
        if (!result.success) {
          return c.json({ message: result.error.issues[0]?.message ?? "Invalid input" }, 400);
        }
      }),
      async (c) => {
        const body = c.req.valid("json");
        const result = await cntr.users.createUser({
          email: body.email,
          name: body.name ?? null,
        });
        if (!isOk(result)) {
          if (result.value === "Conflict") {
            return c.json({ message: "conflict" }, 409);
          }
          if (result.value === "Invalid") {
            return c.json({ message: "invalid" }, 400);
          }
          return c.json({ message: "unexpected" }, 500);
        }
        return c.json(result.value, 201);
      },
    )
    .get(
      "/:id",
      zValidator("param", uuidParamSchema, (result, c) => {
        if (!result.success) {
          return c.json({ message: result.error.issues[0]?.message ?? "Invalid input" }, 400);
        }
      }),
      async (c) => {
        const { id } = c.req.valid("param");
        const result = await cntr.users.getUser(id);
        if (!isOk(result)) {
          if (result.value === "NotFound") {
            return c.json({ message: "not found" }, 404);
          }
          return c.json({ message: "unexpected" }, 500);
        }
        return c.json(result.value, 200);
      },
    )
    .patch(
      "/:id",
      zValidator("param", uuidParamSchema, (result, c) => {
        if (!result.success) {
          return c.json({ message: result.error.issues[0]?.message ?? "Invalid input" }, 400);
        }
      }),
      zValidator("json", UpdateUserRequestSchema, (result, c) => {
        if (!result.success) {
          return c.json({ message: result.error.issues[0]?.message ?? "Invalid input" }, 400);
        }
      }),
      async (c) => {
        const { id } = c.req.valid("param");
        const body = c.req.valid("json");
        const result = await cntr.users.updateUser({
          id,
          name: body.name ?? null,
        });
        if (!isOk(result)) {
          if (result.value === "NotFound") {
            return c.json({ message: "not found" }, 404);
          }
          if (result.value === "Invalid") {
            return c.json({ message: "invalid" }, 400);
          }
          return c.json({ message: "unexpected" }, 500);
        }
        return c.json(result.value, 200);
      },
    );

  return app;
}
