#!/usr/bin/env node
// マイグレーションの expand / contract 規律（docs/deploy/operations.md）を機械的に確かめる。
// deploy.yml は migrate → Worker の順で出すので、migrate の後にデプロイやロールバックが起きると
// 「旧コード + 新スキーマ」で動く時間が必ずある。旧コードを壊す変更（削除・リネーム・型変更・
// DEFAULT なしの NOT NULL）を 1 本のマイグレーションに入れると、その間に書き込みが全部失敗する
// （0007 の SET NOT NULL は、旧コードが issuer 列を入れずに INSERT してサインアップが止まる形）。
//
// 止める文を含めてよいのは、expand 済みのリリースの後の contract のマイグレーションだけ。そのときは
// ファイルに `-- migration-safety: allow <理由>` を書く（理由が PR の差分に出るのでレビューで判断できる）。
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

// 理由は同じ行に書く（\s だと改行をまたいで次の行の SQL を理由として数える）
const ALLOW_MARKER = /--[ \t]*migration-safety:[ \t]*allow[ \t]+\S/i;

const RULES = [
  { pattern: /\bdrop\s+table\b/i, reason: "テーブルの削除" },
  { pattern: /\bdrop\s+column\b/i, reason: "カラムの削除" },
  { pattern: /\brename\s+(column\b|to\b)/i, reason: "リネーム" },
  { pattern: /\bset\s+data\s+type\b|\balter\s+column\s+"?[\w]+"?\s+type\b/i, reason: "型の変更" },
  { pattern: /\bset\s+not\s+null\b/i, reason: "既存カラムへの NOT NULL の追加" },
  // NOT NULL の列から DEFAULT を外すと、列を省いて INSERT する旧コードが「DEFAULT なしの NOT NULL」と同じく失敗する。
  // NULL 可かどうかは文から分からないので NULL 可の列でも止める（旧コードが列を省いたときの値が DEFAULT から NULL に変わる）。
  // 意図した変更なら、その文だけを別のマイグレーションに分けて allow の印を付ける
  { pattern: /\balter\s+column\b[^;]*\bdrop\s+default\b/i, reason: "DEFAULT の削除" },
];

// ADD COLUMN は 1 文に複数並べられる（ADD COLUMN a ... NOT NULL, ADD COLUMN b ... DEFAULT 0）。DEFAULT の有無は
// カラムごとに見る（文全体で見ると、別のカラムの DEFAULT で NOT NULL の追加を見逃す）
const ADD_COLUMN_NOT_NULL_REASON = "DEFAULT なしの NOT NULL カラムの追加";
function addColumnWithoutDefault(statement) {
  return statement
    .split(/,(?=\s*add\s+column\b)/i)
    .some(
      (clause) =>
        /\badd\s+column\b/i.test(clause) &&
        /\bnot\s+null\b/i.test(clause) &&
        !/\bdefault\b/i.test(clause),
    );
}

// SQL を文字列・引用符付きの識別子・ドル引用・コメントを区別しながら文に分ける。正規表現で近似すると、コメント中の `;`、
// 文字列中の `--`、drizzle の区切り（`--> statement-breakpoint`。`;` が無いこともある）のどれかで文の境界がずれ、
// 別の文の DEFAULT を見て違反を見逃す（近似を直すたびに別の形で見逃しが出たので、字句を読む形にした）。
// 照合用の文（normalized）では文字列を '' に、引用符付きの識別子を "x" に置き換える（DEFAULT 'drop column' や
// "default" という名前のカラムを規則の語として数えない）。ドル引用（DO $$ ... $$）の中身は SQL なので、同じ読み方で
// 文に分けて別の文として検査する（中の別の文の DEFAULT やコメントを混ぜない）。EXECUTE に渡す文字列で組み立てた SQL は
// 見ない。表示には元の文を使う
function scanSql(sql) {
  const statements = [];
  const nestedStatements = [];
  const comments = [];
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
  const endOfQuoted = (quote, from, backslashEscapes) => {
    let cursor = from + 1;
    while (cursor < sql.length) {
      if (backslashEscapes && sql[cursor] === "\\") {
        cursor += 2;
      } else if (sql[cursor] === quote && sql[cursor + 1] === quote) {
        cursor += 2;
      } else if (sql[cursor] === quote) {
        return cursor + 1;
      } else {
        cursor += 1;
      }
    }
    return sql.length;
  };
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      const newline = sql.indexOf("\n", index);
      const stop = newline === -1 ? sql.length : newline;
      const comment = sql.slice(index, stop);
      comments.push(comment);
      if (/^-->\s*statement-breakpoint/.test(comment)) {
        flush();
      }
      index = stop;
    } else if (char === "/" && next === "*") {
      const close = sql.indexOf("*/", index + 2);
      const stop = close === -1 ? sql.length : close + 2;
      comments.push(sql.slice(index, stop));
      raw += " ";
      normalized += " ";
      index = stop;
    } else if (char === "'") {
      // E'...' だけはバックスラッシュでエスケープする
      const escapeString = /[eE]$/.test(raw) && !/[\w$][eE]$/.test(raw);
      const stop = endOfQuoted("'", index, escapeString);
      raw += sql.slice(index, stop);
      normalized += "''";
      index = stop;
    } else if (char === '"') {
      const stop = endOfQuoted('"', index, false);
      raw += sql.slice(index, stop);
      normalized += '"x"';
      index = stop;
    } else if (char === "$" && /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(index))) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(index))[0];
      const close = sql.indexOf(tag, index + tag.length);
      const stop = close === -1 ? sql.length : close + tag.length;
      const body = scanSql(sql.slice(index + tag.length, close === -1 ? sql.length : close));
      nestedStatements.push(...body.statements);
      comments.push(...body.comments);
      raw += sql.slice(index, stop);
      normalized += "$$$$";
      index = stop;
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
  return { statements: [...statements, ...nestedStatements], comments };
}

export function findViolations(sql) {
  const { statements, comments } = scanSql(sql);
  // 文字列の中に印の文言があっても許可にしない（コメントの中だけを見る）
  if (comments.some((comment) => ALLOW_MARKER.test(comment))) {
    return [];
  }
  const violations = [];
  for (const statement of statements) {
    const summary = statement.raw.replace(/\s+/g, " ").slice(0, 160);
    if (addColumnWithoutDefault(statement.normalized)) {
      violations.push({ reason: ADD_COLUMN_NOT_NULL_REASON, statement: summary });
    }
    for (const rule of RULES) {
      if (rule.pattern.test(statement.normalized)) {
        violations.push({ reason: rule.reason, statement: summary });
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
