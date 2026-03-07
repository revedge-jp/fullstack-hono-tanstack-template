import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type ApiClient, apiClient } from "@/shared/lib/api";

export type CreateUserActionState = { ok: true } | { ok: false; message: string };

const CreateUserSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

export async function processCreateUser(
  input: CreateUserInput,
  client: ApiClient = apiClient,
): Promise<CreateUserActionState> {
  const body = {
    email: input.email.trim(),
    name: input.name && input.name.trim().length > 0 ? input.name.trim() : null,
  };

  try {
    const res = await client.api.users.$post({ json: body });
    if (!res.ok) {
      try {
        const json = await res.json();
        const message = "message" in json ? String(json.message) : "Failed to create";
        return { ok: false, message };
      } catch {
        return { ok: false, message: "Failed to create" };
      }
    }
  } catch {
    return { ok: false, message: "Failed to create" };
  }

  return { ok: true };
}

export const createUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => CreateUserSchema.parse(data))
  .handler(({ data }) => processCreateUser(data));
