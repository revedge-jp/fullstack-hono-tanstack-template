#!/usr/bin/env node
// 開発プロセスの計測。マージ済み PR の本文・コミット・タイムラインから、レビューの周回数・指摘対応の
// コミット数・リードタイム・マージ待ち・衝突での停止・レビュアー別の検出数・マージ後に見つかった不具合
// （取りこぼし）を集計する。改善を勘ではなく数字で決めるため（どこで時間を使い、何が漏れているか）。
//
// 使い方: node scripts/dev/dev-metrics.mjs [--days 30] [--json]
//   gh の認証（読み取りのみ）を使う。書き込みはしない。
//
// 入力にしている記録（.claude/commands/ship.md と review-full.md の規約）:
//   レビュー往復: N周（主な指摘: …）            … 周回数（必須の行）
//   レビュー検出: ①N ②N ③N                      … レビュアー別の CONFIRMED 件数（任意。③を測るため）
//   原因PR: #N                                   … 不具合修正の PR で、原因を入れた PR（任意。取りこぼしを測るため）
//   コミット見出しの「コードレビュー指摘」         … 指摘対応のコミット（squash 前のコミットを API から読む）
//   needs-rebase ラベル                            … main との衝突で止まった（conflicting-prs.yml が付ける）

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REBASE_LABEL = "needs-rebase";
const REVIEW_FIX_MARKER = "コードレビュー指摘";

export function parseRounds(body) {
  const match = /^レビュー往復:\s*(\d+)\s*周/m.exec(body ?? "");
  return match ? Number(match[1]) : null;
}

// ③をスキップした周は "③-" と書く（数えない）。記録が無ければ null。
export function parseDetections(body) {
  const match = /^レビュー検出:\s*①\s*(\d+|-)\s*②\s*(\d+|-)\s*③\s*(\d+|-)/m.exec(body ?? "");
  if (!match) {
    return null;
  }
  const toCount = (value) => (value === "-" ? null : Number(value));
  return { first: toCount(match[1]), second: toCount(match[2]), third: toCount(match[3]) };
}

export function parseCausePrs(body) {
  const match = /^原因PR:\s*(.+)$/m.exec(body ?? "");
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/#(\d+)/g)].map((found) => Number(found[1]));
}

// Conventional Commits の種別（"fix(ci): …" は fix）。種別の無いタイトルは "other"。
export function prType(title) {
  const match = /^([a-z]+)(\([^)]*\))?!?:/.exec(title ?? "");
  return match ? match[1] : "other";
}

export function countReviewFixCommits(headlines) {
  return headlines.filter((headline) => headline.includes(REVIEW_FIX_MARKER)).length;
}

const hoursBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

export function toPrRecord(node) {
  const timeline = node.timelineItems?.nodes ?? [];
  const readyEvents = timeline.filter((item) => item.__typename === "ReadyForReviewEvent");
  // Draft で作らなかった PR は作成時点から Ready とみなす。Draft に戻して再度 Ready にした場合は最後の Ready。
  const readyAt =
    readyEvents.length > 0 ? readyEvents[readyEvents.length - 1].createdAt : node.createdAt;
  return {
    number: node.number,
    title: node.title,
    type: prType(node.title),
    rounds: parseRounds(node.body),
    detections: parseDetections(node.body),
    causePrs: parseCausePrs(node.body),
    reviewFixCommits: countReviewFixCommits(
      (node.commits?.nodes ?? []).map((commit) => commit.commit.messageHeadline),
    ),
    leadHours: hoursBetween(node.createdAt, node.mergedAt),
    waitHours: hoursBetween(readyAt, node.mergedAt),
    stalledByConflict: timeline.some(
      (item) => item.__typename === "LabeledEvent" && item.label?.name === REBASE_LABEL,
    ),
  };
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function summarize(records) {
  const withRounds = records.filter((record) => record.rounds !== null);
  const roundBuckets = { one: 0, two: 0, three: 0, fourOrMore: 0 };
  for (const { rounds } of withRounds) {
    if (rounds <= 1) {
      roundBuckets.one += 1;
    } else if (rounds === 2) {
      roundBuckets.two += 1;
    } else if (rounds === 3) {
      roundBuckets.three += 1;
    } else {
      roundBuckets.fourOrMore += 1;
    }
  }
  const detectionTotals = { first: 0, second: 0, third: 0, thirdSkipped: 0, recorded: 0 };
  for (const { detections } of records) {
    if (!detections) {
      continue;
    }
    detectionTotals.recorded += 1;
    detectionTotals.first += detections.first ?? 0;
    detectionTotals.second += detections.second ?? 0;
    if (detections.third === null) {
      detectionTotals.thirdSkipped += 1;
    } else {
      detectionTotals.third += detections.third;
    }
  }
  const byType = {};
  for (const { type } of records) {
    byType[type] = (byType[type] ?? 0) + 1;
  }
  const escapes = records.flatMap((record) =>
    record.causePrs.map((cause) => ({ cause, fixedBy: record.number })),
  );
  return {
    count: records.length,
    byType,
    rounds: {
      median: percentile(
        withRounds.map((record) => record.rounds),
        0.5,
      ),
      buckets: roundBuckets,
      unrecorded: records.length - withRounds.length,
    },
    reviewFixCommits: records.reduce((sum, record) => sum + record.reviewFixCommits, 0),
    leadHours: {
      median: percentile(
        records.map((record) => record.leadHours),
        0.5,
      ),
      p90: percentile(
        records.map((record) => record.leadHours),
        0.9,
      ),
    },
    waitHours: {
      median: percentile(
        records.map((record) => record.waitHours),
        0.5,
      ),
      p90: percentile(
        records.map((record) => record.waitHours),
        0.9,
      ),
    },
    stalledByConflict: records
      .filter((record) => record.stalledByConflict)
      .map((record) => record.number),
    detections: detectionTotals,
    escapes,
  };
}

const formatHours = (hours) => {
  if (hours === null) {
    return "-";
  }
  return hours < 1 ? `${Math.round(hours * 60)}分` : `${hours.toFixed(1)}時間`;
};

export function renderMarkdown(summary, records, days) {
  const lines = [];
  const { rounds, detections } = summary;
  lines.push(`## 開発メトリクス（直近 ${days} 日・マージ済み ${summary.count} 本）`, "");
  lines.push(
    `- 種別: ${Object.entries(summary.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type} ${count}`)
      .join(" / ")}`,
  );
  lines.push(
    `- レビュー周回: 中央値 ${rounds.median ?? "-"} 周（1周 ${rounds.buckets.one} / 2周 ${rounds.buckets.two} / 3周 ${rounds.buckets.three} / 4周以上 ${rounds.buckets.fourOrMore} / 記録なし ${rounds.unrecorded}）`,
  );
  lines.push(`- 指摘対応のコミット: 合計 ${summary.reviewFixCommits}`);
  lines.push(
    `- リードタイム（作成→マージ）: 中央値 ${formatHours(summary.leadHours.median)} / p90 ${formatHours(summary.leadHours.p90)}`,
  );
  lines.push(
    `- マージ待ち（Ready→マージ）: 中央値 ${formatHours(summary.waitHours.median)} / p90 ${formatHours(summary.waitHours.p90)}`,
  );
  lines.push(
    `- 衝突で止まった PR（${REBASE_LABEL}）: ${summary.stalledByConflict.length} 本${summary.stalledByConflict.length ? `（${summary.stalledByConflict.map((n) => `#${n}`).join(", ")}）` : ""}`,
  );
  lines.push(
    detections.recorded === 0
      ? "- レビュアー別の検出数: 記録なし（本文の「レビュー検出:」行）"
      : `- レビュアー別の検出数（記録のある ${detections.recorded} 本）: ① ${detections.first} / ② ${detections.second} / ③ ${detections.third}（③スキップ ${detections.thirdSkipped} 本）`,
  );
  lines.push(
    summary.escapes.length === 0
      ? "- 取りこぼし（マージ後に不具合が見つかった PR）: 記録なし（修正 PR 本文の「原因PR:」行）"
      : `- 取りこぼし: ${summary.escapes.length} 件（${summary.escapes.map((escape) => `#${escape.cause} → 修正 #${escape.fixedBy}`).join(", ")}）`,
  );
  const heavy = records
    .filter((record) => record.rounds !== null && record.rounds >= 3)
    .sort((a, b) => b.rounds - a.rounds)
    .slice(0, 5);
  if (heavy.length > 0) {
    lines.push(
      "",
      "### 周回の多い PR",
      "",
      "| PR | 周回 | 指摘対応コミット | リードタイム | タイトル |",
      "|---|---|---|---|---|",
    );
    for (const record of heavy) {
      lines.push(
        `| #${record.number} | ${record.rounds} | ${record.reviewFixCommits} | ${formatHours(record.leadHours)} | ${record.title.replaceAll("|", "\\|")} |`,
      );
    }
  }
  return lines.join("\n");
}

const QUERY = `query($search: String!, $cursor: String) {
  search(query: $search, type: ISSUE, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title body createdAt mergedAt
        commits(first: 100) { nodes { commit { messageHeadline } } }
        timelineItems(first: 100, itemTypes: [READY_FOR_REVIEW_EVENT, LABELED_EVENT]) {
          nodes {
            __typename
            ... on ReadyForReviewEvent { createdAt }
            ... on LabeledEvent { createdAt label { name } }
          }
        }
      }
    }
  }
}`;

function fetchMergedPrs(days) {
  const repo = execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    {
      encoding: "utf8",
    },
  ).trim();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const search = `repo:${repo} is:pr is:merged merged:>=${since}`;
  const nodes = [];
  let cursor = null;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `search=${search}`];
    if (cursor) {
      args.push("-f", `cursor=${cursor}`);
    }
    const page = JSON.parse(
      execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
    );
    const result = page.data.search;
    nodes.push(...result.nodes.filter((node) => node.number !== undefined));
    if (!result.pageInfo.hasNextPage) {
      break;
    }
    cursor = result.pageInfo.endCursor;
  }
  return nodes;
}

function main(argv) {
  const daysIndex = argv.indexOf("--days");
  const days = daysIndex >= 0 ? Number(argv[daysIndex + 1]) : 30;
  if (!Number.isFinite(days) || days <= 0) {
    process.stderr.write("--days には正の数を渡してください\n");
    process.exit(1);
  }
  const records = fetchMergedPrs(days)
    .map(toPrRecord)
    .sort((a, b) => b.number - a.number);
  const summary = summarize(records);
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ days, summary, records }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderMarkdown(summary, records, days)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
