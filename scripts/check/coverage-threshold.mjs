#!/usr/bin/env node
// ユニットテストのカバレッジ閾値チェック。
//
// bun のカバレッジ閾値は bunfig.toml でしか設定できず、unit と integration の両方の
// `bun test --coverage` に適用されてしまう。閾値は本来「unit でカバーすべき純粋ロジック層」に
// 対するものなので、lcov を解析して対象層に限定して判定する。
//
// 対象: apps/api-service/src/features/*/(domain|application)（純粋ロジック層）
//   - infrastructure / presentation / routes / app.ts は integration テストでカバーするため対象外
//   - 生成物・パッケージ横断ファイル（../../packages/**）も対象外
//
// 使い方: node scripts/check/coverage-threshold.mjs <lcov.info のパス>
//   閾値は環境変数 COVERAGE_THRESHOLD（%）で上書き可能（既定 85）。
import { readFileSync } from "node:fs";

const lcovPath = process.argv[2];
const threshold = Number(process.env.COVERAGE_THRESHOLD ?? "85");

if (!lcovPath) {
  console.error("usage: coverage-threshold.mjs <lcov.info>");
  process.exit(2);
}

// lcov の SF パスは実行 cwd からの相対。対象は COVERAGE_TARGET（正規表現文字列）で指定可能。
// 既定は api-service の純粋ロジック層（src/features/*/domain|application）。
// 例（client）: COVERAGE_TARGET='(^|/)features/[^/]+/(actions|queries)/'
const TARGET = new RegExp(
  process.env.COVERAGE_TARGET ?? "(^|/)src/features/[^/]+/(domain|application)/",
);
const LABEL = process.env.COVERAGE_LABEL ?? "domain/application";
const isTarget = (sf) => TARGET.test(sf) && !/\.test\.[tj]sx?$/.test(sf);

let lcov;
try {
  lcov = readFileSync(lcovPath, "utf8");
} catch {
  console.error(`lcov が読めません: ${lcovPath}`);
  process.exit(2);
}

let totalLF = 0;
let totalLH = 0;
const perFile = [];
let sf = null;
let lf = 0;
let lh = 0;
for (const line of lcov.split("\n")) {
  if (line.startsWith("SF:")) {
    sf = line.slice(3);
    lf = 0;
    lh = 0;
  } else if (line.startsWith("LF:")) {
    lf = Number(line.slice(3));
  } else if (line.startsWith("LH:")) {
    lh = Number(line.slice(3));
  } else if (line.startsWith("end_of_record")) {
    if (sf && isTarget(sf)) {
      totalLF += lf;
      totalLH += lh;
      perFile.push({ sf, pct: lf > 0 ? (lh / lf) * 100 : 100, lh, lf });
    }
    sf = null;
  }
}

if (totalLF === 0) {
  console.error(`対象ファイル（${LABEL}）が lcov に見つかりません`);
  process.exit(2);
}

const pct = (totalLH / totalLF) * 100;
console.log(
  `ユニットカバレッジ（${LABEL}）: ${pct.toFixed(1)}% (${totalLH}/${totalLF} 行) / 閾値 ${threshold}%`,
);

if (pct + 1e-9 < threshold) {
  console.log("違反: ユニットカバレッジが閾値を下回りました");
  perFile
    .filter((f) => f.pct < 100)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 15)
    .forEach((f) => console.log(`  • ${f.pct.toFixed(1)}%  ${f.sf} (${f.lh}/${f.lf})`));
  process.exit(1);
}

console.log("OK");
process.exit(0);
