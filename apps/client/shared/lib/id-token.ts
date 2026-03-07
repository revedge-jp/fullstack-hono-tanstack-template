import { loadConfig } from "./config";

const METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

const REFRESH_MARGIN_SEC = 5 * 60;

let cached: { token: string; expiresAt: number } | undefined;

function parseExp(token: string): number {
  const payload = token.split(".")[1];
  if (!payload) {
    throw new Error("Invalid JWT: missing payload");
  }
  const json = Buffer.from(payload, "base64url").toString();
  const { exp } = JSON.parse(json) as { exp: number };
  return exp;
}

export async function getIdToken(): Promise<string | undefined> {
  const config = loadConfig();
  // K_SERVICE is automatically set by Cloud Run; skip metadata fetch outside GCP (CI, local, etc.)
  if (config.nodeEnv !== "production" || !process.env.K_SERVICE) {
    return undefined;
  }

  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - REFRESH_MARGIN_SEC > now) {
    return cached.token;
  }

  try {
    const audience = config.apiBaseUrl;
    const url = `${METADATA_URL}?audience=${encodeURIComponent(audience)}`;
    const res = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ID token: ${res.status} ${res.statusText}`);
    }

    const token = await res.text();
    cached = { token, expiresAt: parseExp(token) };
    return token;
  } catch (err) {
    // Refresh failed; fall back to still-valid cached token if available
    if (cached && cached.expiresAt > now) {
      return cached.token;
    }
    throw err;
  }
}
