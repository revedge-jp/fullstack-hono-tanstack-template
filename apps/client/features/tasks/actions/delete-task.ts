import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { AppType } from "api-service";
import { hc } from "hono/client";
import { z } from "zod";

const apiClient = hc<AppType>("/");

const DeleteTaskInputSchema = z.object({ id: z.string() });
const DeleteTaskErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type DeleteTaskResult = { ok: true } | { ok: false; message: string };

export const deleteTaskServerFn = createServerFn({ method: "POST" })
  .inputValidator(DeleteTaskInputSchema)
  .handler(async ({ data }): Promise<DeleteTaskResult> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await apiClient.api.tasks[":id"].$delete(
      { param: { id: data.id } },
      { init: { headers: { cookie } } },
    );
    if (res.ok) {
      return { ok: true };
    }
    const parsed = DeleteTaskErrorResponseSchema.safeParse(await res.json());
    return {
      ok: false,
      message: parsed.success ? parsed.data.error : "タスクの削除に失敗しました",
    };
  });
