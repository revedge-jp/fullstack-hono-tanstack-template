"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { type ApiClient, apiClient } from "@/shared/lib/api";

const CACHE_TAG = "users:list";

export type UpdateUserActionState = { ok: true } | { ok: false; message: string };

const UpdateUserFormSchema = z.object({
  name: z.string().optional(),
});

export async function processUpdateUser(
  formData: FormData,
  client: ApiClient = apiClient,
): Promise<UpdateUserActionState> {
  const userId = formData.get("userId");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId !== "string" || !uuidRegex.test(userId)) {
    return { ok: false, message: "Invalid user id" };
  }
  const id = userId;

  const formObject = Object.fromEntries(formData.entries());
  const validation = UpdateUserFormSchema.safeParse(formObject);
  if (!validation.success) {
    return { ok: false, message: validation.error.issues.at(0)?.message ?? "Invalid input" };
  }

  const body = {
    name:
      validation.data.name && validation.data.name.trim().length > 0
        ? validation.data.name.trim()
        : null,
  };

  try {
    const res = await client.api.users[":id"].$patch({
      param: { id },
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

  updateTag(CACHE_TAG);
  return { ok: true };
}

export async function updateUserAction(
  _prev: UpdateUserActionState,
  formData: FormData,
): Promise<UpdateUserActionState> {
  return processUpdateUser(formData);
}
