import { getUsers } from "@/features/users/queries/get-users";
import { UserListItem } from "./user-list-item";

export async function UsersList() {
  try {
    const items = await getUsers();
    return (
      <ul className="space-y-2">
        {items.length === 0 ? (
          <li className="text-sm text-zinc-600 dark:text-zinc-400">No users.</li>
        ) : (
          items.map((u) => <UserListItem key={u.id} user={u} />)
        )}
      </ul>
    );
  } catch {
    return <p className="text-sm text-red-500">Failed to load users.</p>;
  }
}
