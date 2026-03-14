import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { sql };

export function createDb(connectionString: string) {
  // CF Workers / Hyperdrive requirements:
  //   prepare: false — Hyperdrive runs in transaction mode (no prepared statements)
  //   max: 1 — Hyperdrive manages its own connection pool; using more than 1
  //             connection per request causes "Timed out waiting for a message
  //             from another Hyperdrive node" errors due to internal coordination
  //             failures across Hyperdrive nodes.
  //
  const client = postgres(connectionString, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  return { db, end: () => client.end() };
}

export type Database = ReturnType<typeof createDb>["db"];

export type {
  DbAuthAccount,
  DbAuthSession,
  DbAuthUser,
  DbAuthVerification,
} from "./schema";
export {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "./schema";
