import { describe, expect, test } from "bun:test";

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
});
