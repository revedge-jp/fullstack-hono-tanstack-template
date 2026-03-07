import { type ApiClient, apiClient as defaultApiClient } from "@/shared/lib/api";

const CACHE_TAG = "users:list";

export async function getUsers(options?: { apiClient?: ApiClient }) {
  const client = options?.apiClient ?? defaultApiClient;
  const res = await client.api.users.$get(
    {},
    {
      init: { next: { revalidate: 30, tags: [CACHE_TAG] } },
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch users: ${res.status}`);
  }
  const json = await res.json();
  return json.items;
}
