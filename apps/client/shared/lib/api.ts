import type { AppType } from "api-service";
import { hc } from "hono/client";
import { loadConfig } from "./config";
import { getIdToken } from "./id-token";

const baseUrl = loadConfig().apiBaseUrl;

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getIdToken();
  if (!token) {
    return fetch(input, init);
  }
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export const apiClient = hc<AppType>(baseUrl, { fetch: authFetch });

export type ApiClient = typeof apiClient;
