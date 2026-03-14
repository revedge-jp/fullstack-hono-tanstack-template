import pg from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/app_db";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });

export async function resetDatabase(): Promise<void> {
  await pool.query(
    'TRUNCATE TABLE "auth_sessions", "auth_accounts", "auth_verifications", "auth_users" RESTART IDENTITY CASCADE',
  );
}

export async function closePool(): Promise<void> {
  await pool.end();
}
