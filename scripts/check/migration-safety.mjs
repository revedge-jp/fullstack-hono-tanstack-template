#!/usr/bin/env node
// マイグレーションの expand / contract 規律（docs/deploy/operations.md）を機械的に確かめる。
// deploy.yml は migrate → Worker の順で出すので、migrate の後にデプロイやロールバックが起きると
// 「旧コード + 新スキーマ」で動く時間が必ずある。旧コードを壊す変更（削除・リネーム・型変更・
// DEFAULT なしの NOT NULL）を 1 本のマイグレーションに入れると、その間に書き込みが全部失敗する
// （0007 の SET NOT NULL は、旧コードが issuer 列を入れずに INSERT してサインアップが止まる形）。
//
// 止める文を含めてよいのは、expand 済みのリリースの後の contract のマイグレーションだけ。そのときは
// ファイルの先頭に `-- migration-safety: allow <理由>` を書く（理由が PR の差分に出るのでレビューで判断できる）。
//
// 読むのは drizzle-kit が出す形のうちテーブル・カラム・制約・index・enum の変更だけで、それ以外は止める（許可リスト方式）。
// PostgreSQL の字句をすべて正しく読もうとすると、ブロックコメントの入れ子・ドル引用・E 文字列・CR だけの改行などで
// 文の境界がずれて違反を見逃す形が次々に見つかったため。手書きの SQL（DO ブロック・関数・データの移行など）は
// 別のマイグレーションファイルに分け、allow の印と理由を付ける。
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DRIZZLE_DIR = join(
  fileURLToPath(new URL("../..", import.meta.url)),
  "packages/database/drizzle",
);

// このガードより前に作られ、本番に適用済みの履歴。書き換えられないので対象外にする
// （0002・0003・0006 の型変更、0004 の DEFAULT なしの NOT NULL、0007 の SET NOT NULL を含む）
const LEGACY_MAX_INDEX = 7;

// 理由は同じ行に書く（\s だと改行をまたいで次の行の SQL を理由として数える）。印はファイルの先頭の行コメント（SQL より前）
// だけで認める。途中のコメントまで見ると、読まない書き方（E'...' の中など）で文字列の中身をコメントと取り違えたときに、
// その文言で検査全体が外れる
const ALLOW_MARKER = /^--[ \t]*migration-safety:[ \t]*allow[ \t]+\S/i;
const LEADING_COMMENTS = /^(?:[ \t]*(?:--[^\r\n]*)?\r?\n)*[ \t]*(?:--[^\r\n]*)?/;

const UNREADABLE = "このチェックが読まない書き方（手書きの SQL か、ここで扱わない種類の変更）";

// 文字列（'...'）・引用符付きの識別子（"..."）・行コメント・drizzle の区切り（`--> statement-breakpoint`）・`;` だけを
// 読み、文に分ける。照合用の文（normalized）では文字列を '' に、識別子を "x" に置き換える（DEFAULT 'drop column' や
// "default" という名前のカラムを規則の語として数えない）。表示には元の文を使う
function scanSql(sql) {
  const statements = [];
  let unreadable = false;
  let raw = "";
  let normalized = "";
  let index = 0;
  const flush = () => {
    if (normalized.trim()) {
      statements.push({ raw: raw.trim(), normalized: normalized.trim() });
    }
    raw = "";
    normalized = "";
  };
  const endOfQuoted = (quote, from) => {
    let cursor = from + 1;
    while (cursor < sql.length) {
      if (sql[cursor] === quote && sql[cursor + 1] === quote) {
        cursor += 2;
      } else if (sql[cursor] === quote) {
        return cursor + 1;
      } else {
        cursor += 1;
      }
    }
    unreadable = true;
    return sql.length;
  };
  // CR だけの改行は PostgreSQL では行コメントを終えるが、ここでは読まない
  if (/\r(?!\n)/.test(sql)) {
    unreadable = true;
  }
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      const newline = sql.indexOf("\n", index);
      const stop = newline === -1 ? sql.length : newline;
      const comment = sql.slice(index, stop);
      if (/^-->\s*statement-breakpoint/.test(comment)) {
        flush();
      }
      index = stop;
    } else if (char === "'") {
      // E'...'（バックスラッシュのエスケープ）と U&'...' は読まない
      if (/(^|[^\w$])[eE]$/.test(raw) || raw.endsWith("&")) {
        unreadable = true;
      }
      const stop = endOfQuoted("'", index);
      raw += sql.slice(index, stop);
      normalized += "''";
      index = stop;
    } else if (char === '"') {
      if (raw.endsWith("&")) {
        unreadable = true;
      }
      const stop = endOfQuoted('"', index);
      raw += sql.slice(index, stop);
      normalized += '"x"';
      index = stop;
    } else if (char === "/" && next === "*") {
      unreadable = true;
      raw += char;
      normalized += char;
      index += 1;
    } else if (char === "$") {
      // ドル引用（DO $$ ... $$ 等）と $ を含む識別子
      unreadable = true;
      raw += char;
      normalized += char;
      index += 1;
    } else if (char === ";") {
      flush();
      index += 1;
    } else {
      raw += char;
      normalized += char;
      index += 1;
    }
  }
  flush();
  return { statements, unreadable };
}

// ALTER TABLE の句の並び（ADD COLUMN a ..., ADD COLUMN b ...）を、括弧の外の `,` で分ける（numeric(10, 2) では分けない）
function clausesOf(text) {
  const clauses = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      clauses.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  clauses.push(current.trim());
  return clauses;
}

const IDENTIFIER = String.raw`(?:"x"|[a-z_]\w*)`;
const ALTER_TABLE_HEAD = new RegExp(
  String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${IDENTIFIER}(?:\.${IDENTIFIER})?\s+`,
  "i",
);
const ALTER_COLUMN_HEAD = new RegExp(String.raw`^alter\s+column\s+${IDENTIFIER}\s+`, "i");

// ALTER COLUMN の後ろ。drizzle-kit が出す形のうち、旧コードを壊さないもの
const SAFE_COLUMN_ACTIONS =
  /^(?:set\s+default\b|drop\s+not\s+null$|drop\s+expression$|add\s+generated\b|set\s+(?:generated|increment|start|maxvalue|minvalue|cache|cycle|no\s+cycle)\b)/i;

function columnActionViolation(action) {
  // 値を明示して INSERT する旧コードが失敗する
  if (/^(?:add|set)\s+generated\s+always\b/i.test(action)) {
    return "GENERATED ALWAYS への変更";
  }
  if (/^(?:set\s+data\s+)?type\b/i.test(action)) {
    return "型の変更";
  }
  if (/^set\s+not\s+null$/i.test(action)) {
    return "既存カラムへの NOT NULL の追加";
  }
  // NOT NULL の列から DEFAULT を外すと、列を省いて INSERT する旧コードが「DEFAULT なしの NOT NULL」と同じく失敗する。
  // NULL 可かどうかは文から分からないので NULL 可の列でも止める（旧コードが列を省いたときの値が DEFAULT から NULL に変わる）。
  // IDENTITY を外すのも、旧コードが id を省いて INSERT する形を壊すので同じ扱い
  if (/^drop\s+(?:default|identity)\b|^set\s+default\s+null$/i.test(action)) {
    return "DEFAULT の削除";
  }
  return SAFE_COLUMN_ACTIONS.test(action) ? undefined : UNREADABLE;
}

function clauseViolation(clause) {
  if (/^add\s+column\b/i.test(clause)) {
    // PRIMARY KEY も NOT NULL を含む。GENERATED（IDENTITY・生成列）と serial は値を DB が埋める
    const notNull = /\bnot\s+null\b|\bprimary\s+key\b/i.test(clause);
    const filled = /\bdefault\s+(?!null\b)|\bgenerated\b|\b(?:small|big)?serial\b/i.test(clause);
    return notNull && !filled ? "DEFAULT なしの NOT NULL カラムの追加" : undefined;
  }
  // 主キーは対象の列を暗黙に NOT NULL にする（NULL 可の既存の列なら SET NOT NULL と同じ）
  if (/^add\s+(?:constraint\s+\S+\s+)?primary\s+key\b/i.test(clause)) {
    return "既存カラムへの NOT NULL の追加";
  }
  if (/^add\s+(?:constraint|unique|foreign\s+key|check)\b/i.test(clause)) {
    return undefined;
  }
  if (/^drop\s+column\b/i.test(clause)) {
    return "カラムの削除";
  }
  if (/^drop\s+constraint\b/i.test(clause)) {
    return undefined;
  }
  if (/^rename\b|^set\s+schema\b/i.test(clause)) {
    return "リネーム";
  }
  if (/^(?:enable|disable)\s+row\s+level\s+security$/i.test(clause)) {
    return undefined;
  }
  const alterColumn = ALTER_COLUMN_HEAD.exec(clause);
  if (alterColumn) {
    return columnActionViolation(clause.slice(alterColumn[0].length).trim());
  }
  return UNREADABLE;
}

function statementViolations(normalized) {
  const text = normalized.replace(/\s+/g, " ");
  const alterTable = ALTER_TABLE_HEAD.exec(text);
  if (alterTable) {
    return clausesOf(text.slice(alterTable[0].length)).map(clauseViolation);
  }
  if (/^drop\s+index\b/i.test(text)) {
    return [];
  }
  if (/^drop\s+table\b/i.test(text)) {
    return ["テーブルの削除"];
  }
  if (/^(?:drop|truncate)\b/i.test(text)) {
    return ["削除（型・ビュー・スキーマ・データ等）"];
  }
  if (/^alter\s+type\b/i.test(text)) {
    if (/\brename\b/i.test(text)) {
      return ["リネーム"];
    }
    return [/\badd\s+value\b/i.test(text) ? undefined : UNREADABLE];
  }
  // 追加（CREATE）とデータの移行（INSERT / UPDATE / DELETE）は旧コードを壊さない
  // CREATE FUNCTION / RULE / TRIGGER は中身を読まないので含めない
  if (
    /^create\s+(?:unique\s+)?(?:table|index|type|schema|sequence|view|materialized\s+view|policy|role)\b/i.test(
      text,
    ) ||
    /^(?:insert|update|delete)\b/i.test(text)
  ) {
    return [];
  }
  return [UNREADABLE];
}

export function findViolations(sql) {
  const leading = LEADING_COMMENTS.exec(sql)?.[0] ?? "";
  if (leading.split(/\r?\n/).some((line) => ALLOW_MARKER.test(line.trim()))) {
    return [];
  }
  const { statements, unreadable } = scanSql(sql);
  const violations = [];
  if (unreadable) {
    violations.push({
      reason: UNREADABLE,
      statement: "ブロックコメント・$・E'...'・U&・閉じていない引用符・CR だけの改行のいずれか",
    });
  }
  for (const statement of statements) {
    const summary = statement.raw.replace(/\s+/g, " ").slice(0, 160);
    for (const reason of statementViolations(statement.normalized)) {
      if (reason !== undefined) {
        violations.push({ reason, statement: summary });
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

// Node 22 には import.meta.main が無い。シンボリックリンクを含むパスで起動されても一致するよう実パスで比べる
// （一致しないと main() を呼ばずに exit 0 になり、違反を黙って通す）
if (
  import.meta.main ??
  (process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))
) {
  main();
}
