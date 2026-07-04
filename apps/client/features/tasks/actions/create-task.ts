import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { AppType } from "api-service";
import { hc } from "hono/client";
import { z } from "zod";

const apiClient = hc<AppType>("/");

const CreateTaskInputSchema = z.object({ title: z.string().min(1).max(200) });
const CreateTaskErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type CreateTaskResult = { ok: true } | { ok: false; message: string };

export const createTaskServerFn = createServerFn({ method: "POST" })
  .inputValidator(CreateTaskInputSchema)
  .handler(async ({ data }): Promise<CreateTaskResult> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await apiClient.api.tasks.$post(
      { json: { title: data.title } },
      { init: { headers: { cookie } } },
    );
    if (res.ok) {
      return { ok: true };
    }
    const parsed = CreateTaskErrorResponseSchema.safeParse(await res.json());
    return {
      ok: false,
      message: parsed.success ? parsed.data.error : "タスクの作成に失敗しました",
    };
  });
