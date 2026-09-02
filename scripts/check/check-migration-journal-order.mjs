import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const JOURNAL_PATH = path.join(ROOT_DIR, "packages/database/drizzle/meta/_journal.json");

// drizzle-orm の migrate() は「未適用」判定を _journal.json の配列順(idx)ではなく、
// 各エントリの when(生成時タイムスタンプ)と DB 側 __drizzle_migrations の
// 最新 created_at との大小比較で行う(pg-core/dialect.js)。並行ブランチが独立に
// db:generate を実行し、生成順とマージ順が入れ替わると when が idx と逆転し、
// 後からマージされた(＝idx が大きい)migration が「既に適用済みの日時より古い」と
// 誤判定されてエラーなくサイレントにスキップされる。
const run = async () => {
  const raw = await readFile(JOURNAL_PATH, "utf-8");
  const journal = JSON.parse(raw);

  const violations = [];
  let maxWhenSoFar = -Infinity;
  for (const entry of journal.entries) {
    if (entry.when <= maxWhenSoFar) {
      violations.push(entry);
    }
    maxWhenSoFar = Math.max(maxWhenSoFar, entry.when);
  }

  if (violations.length === 0) {
    console.log("✅ migration journal order check passed");
    return;
  }

  console.error(
    "❌ _journal.json の when が idx 順に単調増加していません(並行ブランチでの db:generate 後、" +
      "マージ順と生成順が入れ替わっている可能性があります):",
  );
  for (const entry of violations) {
    console.error(`- idx=${entry.idx} tag=${entry.tag} when=${entry.when}`);
  }
  process.exit(1);
};

await run();
