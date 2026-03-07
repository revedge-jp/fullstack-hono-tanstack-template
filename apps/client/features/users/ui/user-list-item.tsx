"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type UpdateUserActionState, updateUserAction } from "@/features/users/actions/update";
import type { getUsers } from "@/features/users/queries/get-users";

type UserListItemProps = {
  user: Awaited<ReturnType<typeof getUsers>>[number];
};

export function UserListItem({ user }: UserListItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const prevPendingRef = useRef(false);
  const [state, formAction, isPending] = useActionState<UpdateUserActionState, FormData>(
    updateUserAction,
    { ok: true },
  );

  useEffect(() => {
    if (prevPendingRef.current && !isPending && state.ok) {
      setIsEditing(false);
    }
    prevPendingRef.current = isPending;
  }, [isPending, state.ok]);

  return (
    <li className="text-sm text-zinc-800 dark:text-zinc-200">
      {isEditing ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <span className="mr-2 font-mono text-xs">#{user.id}</span>
          <span>{user.email}</span>
          <span className="text-zinc-500 dark:text-zinc-400">—</span>
          <input
            name="name"
            type="text"
            defaultValue={user.name ?? ""}
            placeholder="optional name"
            className="w-32 rounded-md border px-2 py-1 text-sm dark:border-input dark:bg-input/30"
          />
          <div className="flex gap-1">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "..." : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </Button>
          </div>
          {!state.ok ? (
            <span className="text-red-600 text-xs" role="alert">
              {state.message}
            </span>
          ) : null}
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="mr-2 font-mono text-xs">#{user.id}</span>
          <span>{user.email}</span>
          {user.name ? (
            <span className="text-zinc-500 dark:text-zinc-400">— {user.name}</span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setIsEditing(true)}
          >
            Edit
          </Button>
        </div>
      )}
    </li>
  );
}
