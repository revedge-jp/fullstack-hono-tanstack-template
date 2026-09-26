import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findViolations } from "./migration-safety.mjs";

describe("migration-safety", () => {
  test.each([
    ['ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;', "既存カラムへの NOT NULL の追加"],
    ['ALTER TABLE "t" DROP COLUMN "c";', "カラムの削除"],
    ['DROP TABLE "t";', "テーブルの削除"],
    ['ALTER TABLE "t" RENAME COLUMN "a" TO "b";', "リネーム"],
    ['ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE integer;', "型の変更"],
    ['ALTER TABLE "t" ADD COLUMN "c" text NOT NULL;', "DEFAULT なしの NOT NULL カラムの追加"],
  ])("%s を止める", (sql, reason) => {
    expect(findViolations(sql).map((v) => v.reason)).toContain(reason);
  });

  test.each([
    'ALTER TABLE "t" ADD COLUMN "c" text;',
    'ALTER TABLE "t" ADD COLUMN "c" text DEFAULT \'x\' NOT NULL;',
    'CREATE TABLE "t" ("id" text PRIMARY KEY NOT NULL);',
    'CREATE INDEX "i" ON "t" ("c");',
    '-- DROP TABLE "t" はコメントなので対象外\nALTER TABLE "t" ADD COLUMN "c" text;',
  ])("expand の変更は通す: %s", (sql) => {
    expect(findViolations(sql)).toEqual([]);
  });

  test("1 文に並べた ADD COLUMN は、別のカラムの DEFAULT で NOT NULL の追加を見逃さない", () => {
    const sql = 'ALTER TABLE "t" ADD COLUMN "a" text NOT NULL, ADD COLUMN "b" integer DEFAULT 0;';
    expect(findViolations(sql).map((v) => v.reason)).toContain(
      "DEFAULT なしの NOT NULL カラムの追加",
    );
  });

  test("`;` の無い statement-breakpoint 区切りでも文ごとに見る（次の文の DEFAULT で見逃さない）", () => {
    const sql =
      'ALTER TABLE "t" ADD COLUMN "a" text NOT NULL--> statement-breakpoint\nALTER TABLE "u" ALTER COLUMN "b" SET DEFAULT \'x\'';
    expect(findViolations(sql).map((v) => v.reason)).toContain(
      "DEFAULT なしの NOT NULL カラムの追加",
    );
    const two =
      'ALTER TABLE "t" DROP COLUMN "a"--> statement-breakpoint\nALTER TABLE "t" DROP COLUMN "b"';
    expect(findViolations(two)).toHaveLength(2);
  });

  test("コメント中の ; の後ろの語（DEFAULT 等）を次の文として数えない", () => {
    const sql =
      "-- phase 1; DEFAULT will be added later\nALTER TABLE t ADD COLUMN c text NOT NULL;";
    expect(findViolations(sql).map((v) => v.reason)).toContain(
      "DEFAULT なしの NOT NULL カラムの追加",
    );
  });

  test("DEFAULT の削除を止める", () => {
    const sql = 'ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;';
    expect(findViolations(sql).map((v) => v.reason)).toContain("DEFAULT の削除");
  });

  test("理由を書いた allow マーカーがあれば通す", () => {
    const sql = '-- migration-safety: allow 0010 で expand 済み\nALTER TABLE "t" DROP COLUMN "c";';
    expect(findViolations(sql)).toEqual([]);
  });

  test("理由の無い allow マーカーでは通さない", () => {
    const sql = '-- migration-safety: allow\nALTER TABLE "t" DROP COLUMN "c";';
    expect(findViolations(sql)).toHaveLength(1);
  });

  test("drizzle の statement-breakpoint 区切りでも文ごとに見る", () => {
    const sql =
      'ALTER TABLE "t" ADD COLUMN "a" text;--> statement-breakpoint\nALTER TABLE "t" ALTER COLUMN "a" SET NOT NULL;';
    expect(findViolations(sql)).toHaveLength(1);
  });

  test("文字列中の -- で文の区切りを失わない", () => {
    const sql =
      "ALTER TABLE t ADD COLUMN separator text DEFAULT '--';--> statement-breakpoint\nALTER TABLE t ADD COLUMN required text NOT NULL;";
    expect(findViolations(sql).map((v) => v.reason)).toEqual([
      "DEFAULT なしの NOT NULL カラムの追加",
    ]);
  });

  test.each([
    "ALTER TABLE t ADD COLUMN a text DEFAULT 'a;b' NOT NULL;",
    "ALTER TABLE t ADD COLUMN a text DEFAULT 'drop column';",
    'ALTER TABLE "drop table" ADD COLUMN "a" text;',
    'ALTER TABLE "t" ADD COLUMN "p" numeric(10, 2) DEFAULT 0 NOT NULL;',
    'ALTER TABLE "t" ADD COLUMN "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY;',
  ])("文字列・識別子・括弧の中の語や ; , を SQL として数えない: %s", (sql) => {
    expect(findViolations(sql)).toEqual([]);
  });

  test('"default" という名前のカラムを DEFAULT 句として数えない', () => {
    const sql = 'ALTER TABLE "t" ADD COLUMN "default" text NOT NULL;';
    expect(findViolations(sql)).toHaveLength(1);
  });

  test("文字列の中の allow の文言では通さない", () => {
    const sql =
      "INSERT INTO t VALUES ('-- migration-safety: allow x');\nALTER TABLE t DROP COLUMN c;";
    expect(findViolations(sql).map((v) => v.reason)).toEqual(["カラムの削除"]);
  });

  test.each([
    [
      'ALTER TABLE "t" ADD COLUMN "a" text NOT NULL, ALTER COLUMN "b" SET DEFAULT 0;',
      "DEFAULT なしの NOT NULL カラムの追加",
    ],
    [
      'ALTER TABLE "t" ADD COLUMN "a" int DEFAULT NULL NOT NULL;',
      "DEFAULT なしの NOT NULL カラムの追加",
    ],
    ['ALTER TABLE "t" ADD COLUMN "id" text PRIMARY KEY;', "DEFAULT なしの NOT NULL カラムの追加"],
    ['ALTER TABLE "t" ALTER COLUMN "id" DROP IDENTITY;', "DEFAULT の削除"],
    ['ALTER TABLE "t" RENAME TO "u";', "リネーム"],
    ['DROP TYPE "status";', "削除（型・ビュー・スキーマ・データ等）"],
    ["ALTER TYPE \"status\" RENAME VALUE 'a' TO 'b';", "リネーム"],
  ])("別の句の DEFAULT・DEFAULT NULL・暗黙の NOT NULL などを見逃さない: %s", (sql, reason) => {
    expect(findViolations(sql).map((v) => v.reason)).toEqual([reason]);
  });

  // drizzle-kit が出さない形は、正しく読めるかに関わらず止める（手書きは allow の印と理由を付けて別ファイルにする）
  test.each([
    "DO $$ BEGIN ALTER TABLE t ADD COLUMN r text NOT NULL; ALTER TABLE t ADD COLUMN o int DEFAULT 0; END $$;",
    "/* outer /* inner */ it's */ ALTER TABLE t DROP COLUMN c;\nCOMMENT ON TABLE t IS 'x';",
    "-- note\rALTER TABLE t DROP COLUMN c;",
    "ALTER TABLE t ADD COLUMN a$b$ int DEFAULT 0;\nALTER TABLE t ADD COLUMN b int NOT NULL;",
    "COMMENT ON TABLE t IS $\u00e4$it's$\u00e4$;\nALTER TABLE t DROP COLUMN c;",
    "ALTER TABLE t ADD COLUMN a text DEFAULT E'it\\'s; drop table x' NOT NULL;",
    'ALTER TABLE t ALTER COLUMN U&"c" TYPE text;',
    "ALTER TABLE t ADD COLUMN a text DEFAULT 'unterminated;",
    "ALTER TABLE t DROP c;",
    "ALTER TABLE t ADD c int NOT NULL;",
    "ALTER TABLE t ALTER c TYPE text;",
    "COMMENT ON TABLE t IS 'x';",
  ])("読めない書き方は止める: %s", (sql) => {
    expect(findViolations(sql).map((v) => v.reason)).toContain(
      "読めない書き方（drizzle-kit が出さない形の SQL）",
    );
  });

  test.each([
    "INSERT INTO t (note) VALUES (E'it\\'s -- migration-safety: allow example\ntext');\nALTER TABLE t DROP COLUMN c;",
    'ALTER TABLE "t" DROP COLUMN "c";\n-- migration-safety: allow 後ろに書いた印',
  ])("ファイルの先頭以外の allow の印では通さない: %s", (sql) => {
    expect(findViolations(sql)).not.toEqual([]);
  });

  test("先頭の複数行のコメントの中の allow の印で通す", () => {
    const sql =
      '-- contract: 0010 で expand 済み\n\n-- migration-safety: allow 0010 で expand 済み\nALTER TABLE "t" DROP COLUMN "c";';
    expect(findViolations(sql)).toEqual([]);
  });

  test("読めない書き方も allow の印で通せる", () => {
    const sql = "-- migration-safety: allow 手書きのデータ移行\nDO $$ BEGIN PERFORM 1; END $$;";
    expect(findViolations(sql)).toEqual([]);
  });

  // 実際のマイグレーションで、読めない判定（誤検出）が出ないこと。既知の違反は LEGACY_MAX_INDEX 以前のものだけ
  test("packages/database/drizzle の全ファイルを読め、違反は既知のものだけ", () => {
    const dir = fileURLToPath(new URL("../../packages/database/drizzle", import.meta.url));
    const found = Object.fromEntries(
      readdirSync(dir)
        .filter((file) => file.endsWith(".sql"))
        .map((file) => [
          file.slice(0, 4),
          [...new Set(findViolations(readFileSync(join(dir, file), "utf8")).map((v) => v.reason))],
        ])
        .filter(([, reasons]) => reasons.length > 0),
    );
    expect(found).toEqual({
      "0002": ["型の変更"],
      "0003": ["型の変更"],
      "0004": ["DEFAULT なしの NOT NULL カラムの追加"],
      "0006": ["型の変更"],
      "0007": ["既存カラムへの NOT NULL の追加"],
    });
  });

  // Node 22 は import.meta.main が無く、起動パスで判定する。node -e から import したときは argv[1] が無い
  test("node -e から import しても例外にならない", () => {
    const modulePath = fileURLToPath(new URL("./migration-safety.mjs", import.meta.url));
    const result = spawnSync("node", ["-e", `import(${JSON.stringify(modulePath)})`], {
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
