import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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
    "ALTER TABLE t ADD COLUMN a text DEFAULT E'it\\'s; drop table x' NOT NULL;",
    'ALTER TABLE "drop table" ADD COLUMN "a" text;',
  ])("文字列・識別子の中の語や ; を SQL として数えない: %s", (sql) => {
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

  test("ドル引用の中の ; で文を分けず、中の SQL は検査する", () => {
    const sql =
      "DO $$ BEGIN PERFORM 1; DROP TABLE x; END $$;\nALTER TABLE t ADD COLUMN c text DEFAULT 'x' NOT NULL;";
    expect(findViolations(sql).map((v) => v.reason)).toEqual(["テーブルの削除"]);
  });

  test("ドル引用の中も文ごとに見る（別の文の DEFAULT で見逃さない）", () => {
    const sql =
      "DO $$ BEGIN ALTER TABLE t ADD COLUMN required text NOT NULL; ALTER TABLE t ADD COLUMN optional integer DEFAULT 0; END $$;";
    expect(findViolations(sql).map((v) => v.reason)).toEqual([
      "DEFAULT なしの NOT NULL カラムの追加",
    ]);
  });

  test("ドル引用の中のコメントを SQL として数えない", () => {
    const sql = "DO $$ BEGIN\n-- DROP TABLE t;\nALTER TABLE t ADD COLUMN optional text;\nEND $$;";
    expect(findViolations(sql)).toEqual([]);
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
