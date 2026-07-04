#!/usr/bin/env node
// feature 構造の完全性チェック。
//
// 目的: AI が新機能を追加する際に起きがちな「層の欠落・co-located テスト忘れ・配線忘れ」を
// CI で検出する。scaffolding（生成）ではなく検証側で一貫性を担保する。
// tasks feature を正典構造とみなし、各 feature が必須要素を備えているか確認する。
//
// 検出する欠落:
//  - domain: models.ts（必須）/ {feature}.repository.ts（リポジトリを持つ feature のみ）
//  - application: 2つ以上の action を持つ feature では service.ts / index.ts が必須
//    （auth のように単一 usecase の feature では集約が不要なため対象外）
//  - infrastructure: リポジトリ抽象があるのに実装(*.repository.*.ts)が無い
//  - presentation: router.ts / index.ts
//  - __tests__/contract/{feature}.contract.test.ts（testing.md: contract は常に必要）
//  - 各 usecase.ts の co-located usecase.test.ts
//  - 配線: container.ts への登録 / app.ts への router マウント
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FEATURES_DIR = "apps/api-service/src/features";
const CONTAINER = "apps/api-service/src/container.ts";
const APP = "apps/api-service/src/app.ts";
const CONTRACT_DIR = "apps/api-service/src/__tests__/contract";

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p) => existsSync(p) && statSync(p).isFile();

const violations = [];
const add = (feature, msg) => violations.push(`${feature}: ${msg}`);

if (!isDir(FEATURES_DIR)) {
  console.log(`OK (features ディレクトリなし: ${FEATURES_DIR})`);
  process.exit(0);
}

const containerSrc = isFile(CONTAINER) ? readFileSync(CONTAINER, "utf8") : "";
const appSrc = isFile(APP) ? readFileSync(APP, "utf8") : "";

const features = readdirSync(FEATURES_DIR).filter((name) => isDir(join(FEATURES_DIR, name)));

for (const feature of features) {
  const base = join(FEATURES_DIR, feature);

  // domain
  if (!isFile(join(base, "domain/models.ts"))) add(feature, "domain/models.ts がありません");
  // リポジトリ抽象は、永続化を自前で持つ feature のみ必須（auth のように第三者 SDK が
  // 永続化を担う wrapper feature では該当しない）。存在する場合のみ実装を要求する。
  const repoIface = join(base, `domain/${feature}.repository.ts`);
  const hasRepoIface = isFile(repoIface);

  // application: 2つ以上の action（サブディレクトリ）を持つ feature でのみ
  // service.ts / index.ts による集約を必須とする
  const appDir = join(base, "application");
  const actionDirs = isDir(appDir) ? readdirSync(appDir).filter((n) => isDir(join(appDir, n))) : [];
  const isMultiAction = actionDirs.length >= 2;
  if (isMultiAction) {
    if (!isFile(join(base, "application/service.ts")))
      add(feature, "application/service.ts がありません（action が複数あるため集約が必要）");
    if (!isFile(join(base, "application/index.ts")))
      add(feature, "application/index.ts がありません（action が複数あるため集約が必要）");
  }

  // infrastructure: リポジトリ抽象があれば実装が必要
  const infraDir = join(base, "infrastructure");
  if (hasRepoIface) {
    const hasImpl =
      isDir(infraDir) && readdirSync(infraDir).some((n) => /\.repository\..+\.ts$/.test(n));
    if (!hasImpl) {
      add(feature, "infrastructure に *.repository.*.ts（リポジトリ実装）がありません");
    }
  }

  // presentation
  if (!isFile(join(base, "presentation/router.ts")))
    add(feature, "presentation/router.ts がありません");
  if (!isFile(join(base, "presentation/index.ts")))
    add(feature, "presentation/index.ts がありません");

  // 各 action の usecase.ts には co-located usecase.test.ts が必須（ネスト構造も再帰的に検出）
  if (isDir(appDir)) {
    const walkDirs = (dir) => {
      const result = [dir];
      for (const name of readdirSync(dir)) {
        const child = join(dir, name);
        if (isDir(child)) result.push(...walkDirs(child));
      }
      return result;
    };
    for (const actionDir of walkDirs(appDir)) {
      if (!isDir(actionDir)) continue;
      if (isFile(join(actionDir, "usecase.ts")) && !isFile(join(actionDir, "usecase.test.ts"))) {
        const rel = relative(appDir, actionDir);
        add(
          feature,
          `application/${rel}/usecase.test.ts がありません（usecase には co-located テストが必須）`,
        );
      }
    }
  }

  // contract テスト
  if (!isFile(join(CONTRACT_DIR, `${feature}.contract.test.ts`))) {
    add(
      feature,
      `__tests__/contract/${feature}.contract.test.ts がありません（contract テストは常に必要）`,
    );
  }

  // 配線: import 文の行のみを対象にしてコメント・文字列リテラルの誤検知を防ぐ
  const hasContainerImport = containerSrc
    .split("\n")
    .some((line) => /^\s*import\b/.test(line) && line.includes(`features/${feature}/`));
  if (!hasContainerImport) {
    add(feature, `container.ts に登録されていません（features/${feature}/... の import が無い）`);
  }
  const hasAppImport = appSrc
    .split("\n")
    .some((line) => /^\s*import\b/.test(line) && line.includes(`features/${feature}/presentation`));
  if (!hasAppImport) {
    add(
      feature,
      `app.ts に router がマウントされていません（features/${feature}/presentation の import が無い）`,
    );
  }
}

if (violations.length === 0) {
  console.log("OK");
  process.exit(0);
}

console.log("違反: feature 構造が不完全です（必須の層・テスト・配線が欠落）");
for (const v of violations) console.log(`  • ${v}`);
process.exit(1);
