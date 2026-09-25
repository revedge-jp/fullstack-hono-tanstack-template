import { describe, expect, test } from "bun:test";

import {
  countReviewFixCommits,
  parseCausePrs,
  parseDetections,
  parseRounds,
  prType,
  summarize,
  toPrRecord,
} from "./dev-metrics.mjs";

describe("本文の記録行の読み取り", () => {
  test("往復行が無く収束行だけの PR は指摘なしで収束した 1 周、どちらも無ければ記録なし", () => {
    expect(parseRounds("レビュー収束: 最終周 CONFIRMED 0")).toBe(1);
    expect(parseRounds("レビュー往復: 3周\nレビュー収束: 最終周 CONFIRMED 0")).toBe(3);
    expect(parseRounds("規約以前の本文")).toBeNull();
  });

  test("レビュー往復: 行頭の行だけを周回数として読む", () => {
    expect(parseRounds("概要\n\nレビュー往復: 3周（主な指摘: x）")).toBe(3);
    expect(parseRounds("本文中の「レビュー往復: 2周」という言及")).toBeNull();
    expect(parseRounds(null)).toBeNull();
  });

  test("レビュー検出: ③をスキップした周は null として読む", () => {
    expect(parseDetections("レビュー検出: ①1 ②2 ③0")).toEqual({ first: 1, second: 2, third: 0 });
    expect(parseDetections("レビュー検出: ① 0 ② 1 ③ -")).toEqual({
      first: 0,
      second: 1,
      third: null,
    });
    expect(parseDetections("記録なし")).toBeNull();
  });

  test("原因PR: 行の PR 番号をすべて読む", () => {
    expect(parseCausePrs("原因PR: #104, #109")).toEqual([104, 109]);
    expect(parseCausePrs("本文で #12 に触れているだけ")).toEqual([]);
  });

  test("タイトルの種別（スコープ付き・破壊的変更の ! も種別だけにする）", () => {
    expect(prType("fix(ci): x")).toBe("fix");
    expect(prType("feat!: x")).toBe("feat");
    expect(prType("Update README")).toBe("other");
  });

  test("指摘対応のコミットは件名（1 行目）の印で数え、本文で触れているだけのものは数えない", () => {
    const longSubject = `fix: ${"長い件名".repeat(20)}（コードレビュー指摘）\n\n本文`;
    expect(
      countReviewFixCommits([
        "feat: 本体",
        "fix: 直す（コードレビュー指摘）",
        longSubject,
        "docs: 追記\n\n前回のコードレビュー指摘への補足",
      ]),
    ).toBe(2);
  });
});

const node = (overrides) => ({
  number: 1,
  title: "fix: x",
  body: "",
  createdAt: "2026-09-25T00:00:00Z",
  mergedAt: "2026-09-25T02:00:00Z",
  commits: { nodes: [] },
  timelineItems: { nodes: [] },
  ...overrides,
});

describe("PR ごとの記録", () => {
  test("マージ待ちは最後の Ready から数え、Draft で作らなかった PR は作成時点から数える", () => {
    const drafted = toPrRecord(
      node({
        timelineItems: {
          nodes: [
            { __typename: "ReadyForReviewEvent", createdAt: "2026-09-25T00:30:00Z" },
            { __typename: "ReadyForReviewEvent", createdAt: "2026-09-25T01:30:00Z" },
          ],
        },
      }),
    );
    expect(drafted.leadHours).toBe(2);
    expect(drafted.waitHours).toBe(0.5);
    expect(toPrRecord(node({})).waitHours).toBe(2);
  });

  test("needs-rebase が付いたことがあれば衝突で止まった PR とする（他のラベルは数えない）", () => {
    const labeled = (name) =>
      toPrRecord(
        node({
          timelineItems: {
            nodes: [{ __typename: "LabeledEvent", createdAt: "x", label: { name } }],
          },
        }),
      );
    expect(labeled("needs-rebase").stalledByConflict).toBe(true);
    expect(labeled("bug").stalledByConflict).toBe(false);
  });
});

test("コミット・タイムラインが 100 件を超えた PR には打ち切りの印が付く", () => {
  expect(toPrRecord(node({})).truncated).toBe(false);
  expect(
    toPrRecord(node({ commits: { pageInfo: { hasNextPage: true }, nodes: [] } })).truncated,
  ).toBe(true);
  expect(
    toPrRecord(node({ timelineItems: { pageInfo: { hasPreviousPage: true }, nodes: [] } }))
      .truncated,
  ).toBe(true);
});

describe("集計", () => {
  test("周回の分布・記録なし・レビュアー別の検出数・取りこぼしを数える", () => {
    const records = [
      toPrRecord(node({ number: 1, body: "レビュー往復: 1周\nレビュー検出: ①0 ②1 ③1" })),
      toPrRecord(node({ number: 2, body: "レビュー往復: 4周\nレビュー検出: ①2 ②1 ③-" })),
      toPrRecord(node({ number: 3, title: "fix: 回帰", body: "原因PR: #1" })),
    ];
    const summary = summarize(records);
    expect(summary.rounds.buckets).toEqual({
      one: 1,
      oneClean: 1,
      two: 0,
      three: 0,
      fourOrMore: 1,
    });
    expect(summary.rounds.unrecorded).toBe(1);
    expect(summary.detections).toEqual({
      first: 2,
      second: 2,
      third: 1,
      thirdSkipped: 1,
      recorded: 2,
    });
    expect(summary.escapes).toEqual([{ cause: 1, fixedBy: 3 }]);
  });
});
