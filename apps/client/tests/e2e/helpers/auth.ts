import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import pg from "pg";

// アプリ（client の Worker）が実際に読む .dev.vars から接続情報・シークレットを解決する。
// テスト側だけ別の DB / secret を見てしまう食い違いを防ぐため、env 直読みより優先する。
function readDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(join(import.meta.dirname, "../../../.dev.vars"), "utf8");
    const vars: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=["']?([^"']*)["']?\s*$/);
      if (m?.[1] && m[2] !== undefined) {
        vars[m[1]] = m[2];
      }
    }
    return vars;
  } catch {
    return {};
  }
}

const devVars = readDevVars();
const DATABASE_URL =
  devVars.DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/app_db";
const BETTER_AUTH_SECRET =
  devVars.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "dummy-secret-for-e2e";

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

// better-call（Better Auth が cookie 署名に使うライブラリ）の signCookieValue と同じ方式:
// HMAC-SHA-256 → base64（パディングあり）→ `${token}.${signature}` を encodeURIComponent
async function signSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${token}.${base64}`);
}

export type SeededUser = {
  userId: string;
  email: string;
  /** Playwright の context に注入してこのユーザーとしてログイン状態にする */
  signIn: (context: BrowserContext) => Promise<void>;
  /** ユーザーを削除する（sessions / tasks は FK cascade で消える） */
  cleanup: () => Promise<void>;
};

/**
 * Google OAuth を経由せずにログイン済み状態を作る。
 * DB に user + session 行を直接シードし、Better Auth と同じ方式で署名した
 * session cookie をブラウザコンテキストに注入する。
 */
export async function seedSignedInUser(name: string): Promise<SeededUser> {
  const userId = `e2e-${name}-${crypto.randomUUID()}`;
  const email = `${userId}@example.com`;
  const sessionToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO "auth_users" ("id", "name", "email", "email_verified") VALUES ($1, $2, $3, true)`,
    [userId, `E2E ${name}`, email],
  );
  await pool.query(
    `INSERT INTO "auth_sessions" ("id", "token", "user_id", "expires_at") VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), sessionToken, userId, expiresAt],
  );

  const cookieValue = await signSessionToken(sessionToken, BETTER_AUTH_SECRET);

  return {
    userId,
    email,
    signIn: async (context) => {
      await context.addCookies([
        {
          name: "better-auth.session_token",
          value: cookieValue,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    },
    cleanup: async () => {
      await pool.query(`DELETE FROM "auth_users" WHERE "id" = $1`, [userId]);
    },
  };
}

export async function closeAuthPool(): Promise<void> {
  await pool.end();
}
