#!/usr/bin/env node
// マイグレーションの expand / contract 規律（docs/deploy/operations.md）を機械的に確かめる。
// deploy.yml は migrate → Worker の順で出すので、migrate の後にデプロイやロールバックが起きると
// 「旧コード + 新スキーマ」で動く時間が必ずある。旧コードを壊す変更（削除・リネーム・型変更・
// DEFAULT なしの NOT NULL）を 1 本のマイグレーションに入れると、その間に書き込みが全部失敗する
// （0007 の SET NOT NULL は、旧コードが issuer 列を入れずに INSERT してサインアップが止まる形）。
//
// 止める文を含めてよいのは、expand 済みのリリースの後の contract のマイグレーションだけ。そのときは
// ファイルに `-- migration-safety: allow <理由>` を書く（理由が PR の差分に出るのでレビューで判断できる）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DRIZZLE_DIR = join(
  fileURLToPath(new URL("../..", import.meta.url)),
  "packages/database/drizzle",
);

// このガードより前に作られ、本番に適用済みの履歴。書き換えられないので対象外にする
// （0002・0003・0006 の型変更、0004 の DEFAULT なしの NOT NULL、0007 の SET NOT NULL を含む）
const LEGACY_MAX_INDEX = 7;

// 理由は同じ行に書く（\s だと改行をまたいで次の行の SQL を理由として数える）
const ALLOW_MARKER = /--[ \t]*migration-safety:[ \t]*allow[ \t]+\S/i;

const RULES = [
  { pattern: /\bdrop\s+table\b/i, reason: "テーブルの削除" },
  { pattern: /\bdrop\s+column\b/i, reason: "カラムの削除" },
  { pattern: /\brename\s+(column\b|to\b)/i, reason: "リネーム" },
  { pattern: /\bset\s+data\s+type\b|\balter\s+column\s+"?[\w]+"?\s+type\b/i, reason: "型の変更" },
  { pattern: /\bset\s+not\s+null\b/i, reason: "既存カラムへの NOT NULL の追加" },
  {
    pattern: /\badd\s+column\b(?![^;]*\bdefault\b)[^;]*\bnot\s+null\b/i,
    reason: "DEFAULT なしの NOT NULL カラムの追加",
  },
];

// SQL の行コメントを外してから文ごとに分ける（コメントの中の語で誤検出しない）
function statementsOf(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(/;|-->\s*statement-breakpoint/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function findViolations(sql) {
  if (ALLOW_MARKER.test(sql)) {
    return [];
  }
  const violations = [];
  for (const statement of statementsOf(sql)) {
    for (const rule of RULES) {
      if (rule.pattern.test(statement)) {
        violations.push({
          reason: rule.reason,
          statement: statement.replace(/\s+/g, " ").slice(0, 160),
        });
      }
    }
  }
  return violations;
}

function migrationIndex(file) {
  const match = /^(\d+)_/.exec(file);
  return match ? Number(match[1]) : undefined;
}

function main() {
  const files = readdirSync(DRIZZLE_DIR).filter((file) => file.endsWith(".sql"));
  let failed = false;
  for (const file of files.sort()) {
    const index = migrationIndex(file);
    if (index !== undefined && index <= LEGACY_MAX_INDEX) {
      continue;
    }
    const violations = findViolations(readFileSync(join(DRIZZLE_DIR, file), "utf8"));
    for (const violation of violations) {
      failed = true;
      console.error(`❌ ${file}: ${violation.reason} — ${violation.statement}`);
    }
  }
  if (failed) {
    console.error(
      [
        "",
        "旧コードを壊すスキーマ変更です。expand（追加）と contract（削除・制約の追加）を別のリリースに分けてください（docs/deploy/operations.md）。",
        "expand 済みの後の contract なら、そのファイルに `-- migration-safety: allow <理由>` を書いてください。",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log("✅ マイグレーションの expand / contract チェック: OK");
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
