import { closeAuthPool } from "./helpers/auth";
import { closePool, resetDatabase } from "./helpers/reset-db";

export default async function globalTeardown() {
  console.log("[global-teardown] Cleaning up test database...");
  await resetDatabase();
  await closePool();
  // spec ごとの閉じ忘れを防ぐため、auth helper の pool もここで集約して閉じる
  await closeAuthPool();
  console.log("[global-teardown] Cleanup complete.");
}
