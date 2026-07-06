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
  "ui-shadcn",
  "drizzle",
  "migrations",
  "prisma",
]);

const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedBaseNames = new Set(["README", "Dockerfile", "Makefile", "$"]); // $ は TanStack Start の catch-all route
const allowedSuffixes = [".test", ".spec", ".gen"];
// TanStack Router convention: __root.tsx and _layout.tsx are required by the framework
const allowedPrefixes = ["__", "_"];

const violations = [];

const shouldSkipEntry = (entryName) => entryName.startsWith(".");

const isKebabCase = (name) => name.split(".").every((segment) => kebabCasePattern.test(segment));

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
    if (!isKebabCase(normalizedBaseName)) {
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
