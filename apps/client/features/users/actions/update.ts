import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type ApiClient, apiClient } from "@/shared/lib/api";

export type UpdateUserActionState = { ok: true } | { ok: false; message: string };

const UpdateUserSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: "Invalid user id",
  }),
  name: z.string().optional(),
});

type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export async function processUpdateUser(
  input: UpdateUserInput,
  client: ApiClient = apiClient,
): Promise<UpdateUserActionState> {
  const body = {
    name: input.name && input.name.trim().length > 0 ? input.name.trim() : null,
  };

  try {
    const res = await client.api.users[":id"].$patch({
      param: { id: input.id },
      json: body,
    });
    if (!res.ok) {
      try {
        const json = await res.json();
        const message = "message" in json ? String(json.message) : "Failed to update";
        return { ok: false, message };
      } catch {
        return { ok: false, message: "Failed to update" };
      }
    }
  } catch {
    return { ok: false, message: "Failed to update" };
  }

  return { ok: true };
}

export const updateUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => UpdateUserSchema.parse(data))
  .handler(({ data }) => processUpdateUser(data));
