import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { updateUserFn } from "@/features/users/actions/update";
import type { getUsers } from "@/features/users/queries/get-users";

type UserListItemProps = {
  user: Awaited<ReturnType<typeof getUsers>>[number];
};

export function UserListItem({ user }: UserListItemProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const prevPendingRef = useRef(false);

  const mutation = useMutation({
    mutationFn: (data: { id: string; name?: string }) => updateUserFn({ data }),
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["users"] });
      }
    },
  });

  useEffect(() => {
    if (prevPendingRef.current && !mutation.isPending && mutation.data?.ok) {
      setIsEditing(false);
    }
    prevPendingRef.current = mutation.isPending;
  }, [mutation.isPending, mutation.data?.ok]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    mutation.mutate({ id: user.id, name: name || undefined });
  }

  const error = mutation.data?.ok === false ? mutation.data.message : null;

  return (
    <li className="text-sm text-zinc-800 dark:text-zinc-200">
      {isEditing ? (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
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
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? "..." : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </Button>
          </div>
          {error ? (
            <span className="text-red-600 text-xs" role="alert">
              {error}
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
