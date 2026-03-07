import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, apiClient as defaultApiClient } from "@/shared/lib/api";

export async function getUsers(options?: { apiClient?: ApiClient }) {
  const client = options?.apiClient ?? defaultApiClient;
  const res = await client.api.users.$get();
  if (!res.ok) {
    throw new Error(`Failed to fetch users: ${res.status}`);
  }
  const json = await res.json();
  return json.items;
}

export const getUsersQueryOptions = (apiClient?: ApiClient) =>
  queryOptions({
    queryKey: ["users"],
    queryFn: () => getUsers({ apiClient }),
    staleTime: 30 * 1000,
  });
