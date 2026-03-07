import { closePool, resetDatabase } from "./helpers/reset-db";

export default async function globalTeardown() {
  console.log("[global-teardown] Cleaning up test database...");
  await resetDatabase();
  await closePool();
  console.log("[global-teardown] Cleanup complete.");
}
