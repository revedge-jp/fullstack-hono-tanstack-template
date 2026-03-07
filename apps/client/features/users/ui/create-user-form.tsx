"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type CreateUserActionState, createUserAction } from "@/features/users/actions/create";

export function CreateUserForm() {
  const [state, formAction, isPending] = useActionState<CreateUserActionState, FormData>(
    createUserAction,
    { ok: true },
  );

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input
        name="email"
        type="email"
        placeholder="email@example.com"
        required
        className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
      />
      <input
        name="name"
        type="text"
        placeholder="optional name"
        className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
      />
      {!state.ok ? (
        <div className="text-red-600 text-sm" role="alert">
          {state.message}
        </div>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating..." : "Create"}
        </Button>
      </div>
    </form>
  );
}
