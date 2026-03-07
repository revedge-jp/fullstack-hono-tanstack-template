"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { type ApiClient, apiClient } from "@/shared/lib/api";

const CACHE_TAG = "users:list";

export type CreateUserActionState = { ok: true } | { ok: false; message: string };

const CreateUserFormSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
});

export async function processCreateUser(
  formData: FormData,
  client: ApiClient = apiClient,
): Promise<CreateUserActionState> {
  const formObject = Object.fromEntries(formData.entries());
  const validation = CreateUserFormSchema.safeParse(formObject);
  if (!validation.success) {
    return { ok: false, message: validation.error.issues.at(0)?.message ?? "Invalid input" };
  }

  const body = {
    email: validation.data.email.trim(),
    name:
      validation.data.name && validation.data.name.trim().length > 0
        ? validation.data.name.trim()
        : null,
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

  updateTag(CACHE_TAG);
  return { ok: true };
}

export async function createUserAction(
  _prev: CreateUserActionState,
  formData: FormData,
): Promise<CreateUserActionState> {
  return processCreateUser(formData);
}
