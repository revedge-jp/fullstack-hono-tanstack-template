import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { AppType } from "api-service";
import { hc } from "hono/client";
import { z } from "zod";

const apiClient = hc<AppType>("/");

const AdvanceTaskInputSchema = z.object({ id: z.string() });
const AdvanceTaskErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string() });

export type AdvanceTaskResult = { ok: true } | { ok: false; message: string };

export const advanceTaskServerFn = createServerFn({ method: "POST" })
  .inputValidator(AdvanceTaskInputSchema)
  .handler(async ({ data }): Promise<AdvanceTaskResult> => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";
    const res = await apiClient.api.tasks[":id"].$patch(
      { param: { id: data.id } },
      { init: { headers: { cookie } } },
    );
    if (res.ok) {
      return { ok: true };
    }
    const parsed = AdvanceTaskErrorResponseSchema.safeParse(await res.json());
    return {
      ok: false,
      message: parsed.success ? parsed.data.error : "タスクの更新に失敗しました",
    };
  });
