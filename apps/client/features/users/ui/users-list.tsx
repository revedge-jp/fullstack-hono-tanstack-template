import { useSuspenseQuery } from "@tanstack/react-query";
import { getUsersQueryOptions } from "@/features/users/queries/get-users";
import { UserListItem } from "./user-list-item";

export function UsersList() {
  const { data: items } = useSuspenseQuery(getUsersQueryOptions());

  return (
    <ul className="space-y-2">
      {items.length === 0 ? (
        <li className="text-sm text-zinc-600 dark:text-zinc-400">No users.</li>
      ) : (
        items.map((u) => <UserListItem key={u.id} user={u} />)
      )}
    </ul>
  );
}
