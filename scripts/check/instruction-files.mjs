#!/usr/bin/env node
// 指示ファイル(AGENTS.md / CLAUDE.md / REVIEW.md / apps/*/AGENTS.md / .claude/rules / .claude/commands)
// の参照整合チェック。
//
// 目的: 指示ファイルはコードと違って lint も typecheck も効かないため、ファイル移動・スクリプト改名・
// 見出し変更で参照が黙って腐る。腐った参照はエージェントに「存在しないヘルパを探す」「無い
// コマンドを叩く」をさせ、写経や独自実装の起点になる。ここでは 3 種類の参照を実在確認する:
//  1. バッククォート内のパス(`scripts/check/foo.sh`、`../../AGENTS.md` 等)
//  2. `bun run <script>` の <script> が package.json(ルート or apps/*)の scripts に存在する
//  3. `AGENTS.md の「見出し」` 形式の見出し参照が AGENTS.md に存在する
// 誤検出を避けるため、glob(* ? { })・プレースホルダ(<xxx> / {xxx} / Xxx)・URL は対象外。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const APPS = readdirSync(join(ROOT, "apps"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "REVIEW.md",
  ...APPS.map((app) => `apps/${app}/AGENTS.md`),
  ...readdirSync(join(ROOT, ".claude/rules")).map((f) => `.claude/rules/${f}`),
  ...readdirSync(join(ROOT, ".claude/commands")).map((f) => `.claude/commands/${f}`),
].filter((f) => existsSync(join(ROOT, f)));

const scriptNames = new Set();
for (const pkg of [
  "package.json",
  ...readdirSync(join(ROOT, "apps")).map((a) => `apps/${a}/package.json`),
]) {
  const full = join(ROOT, pkg);
  if (!existsSync(full)) {
    continue;
  }
  for (const name of Object.keys(JSON.parse(readFileSync(full, "utf8")).scripts ?? {})) {
    scriptNames.add(name);
  }
}

// コードフェンス内の `# コメント` を見出しと誤認しないよう、フェンスの外だけを見る
const collectHeadings = (text) => {
  const headings = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && /^#{1,6} /.test(line)) {
      headings.push(line.replace(/^#+ /, "").trim());
    }
  }
  return headings;
};
const agentsHeadings = collectHeadings(readFileSync(join(ROOT, "AGENTS.md"), "utf8"));
// 「Testing」が「Testing Conventions」に一致しないよう、完全一致か「見出し (補足)」の補足省略だけ許す
const hasHeading = (name) => agentsHeadings.some((h) => h === name || h.startsWith(`${name} (`));

// スラッシュを含み、リポジトリ内の既知ディレクトリから始まるものだけを「パス」とみなす。
// 裸のファイル名(`usecase.ts` 等)は構造説明で多用され実在確認に意味が無いので対象外。
const KNOWN_PREFIX =
  /^(\.\.?\/|apps\/|packages\/|scripts\/|docs\/|\.claude\/|\.github\/|src\/|features\/|shared\/|integrations\/|middlewares\/|test-helpers\/|app\/|components\/|tests\/)/;
const looksLikePath = (t) =>
  KNOWN_PREFIX.test(t) &&
  !/[\s*?{}<>()|"'$[\]]/.test(t) &&
  !/\.\.\.$|\/$/.test(t) && // `features/B/...` や `application/` のような説明用
  !/\/[A-Z]\/|\/[xX]xx|\{feature\}|\{action\}|\/[a-z]+Xxx/.test(t); // プレースホルダ

const violations = [];
for (const file of FILES) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const dir = dirname(join(ROOT, file));
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const token = m[1].replace(/[:#].*$/, ""); // `path:line` / `path#anchor` の付加部分を落とす
      if (!looksLikePath(token)) {
        continue;
      }
      if (token.startsWith("bun run ")) {
        const name = token.slice("bun run ".length).split(/\s/)[0];
        if (!scriptNames.has(name)) {
          violations.push(`${where}: \`bun run ${name}\` に対応する scripts が無い`);
        }
        continue;
      }
      // ファイル相対 → リポジトリルート相対 → apps/* 配下 の順で探す(rules は root 相対で書かれる)
      const candidates = [
        resolve(dir, token),
        join(ROOT, token),
        join(ROOT, "apps", token),
        ...APPS.map((a) => join(ROOT, "apps", a, token)),
        ...APPS.map((a) => join(ROOT, "apps", a, "src", token)),
      ];
      if (!candidates.some((c) => existsSync(c))) {
        violations.push(`${where}: \`${token}\` が実在しない`);
      }
    }
    for (const m of line.matchAll(/`bun run ([\w:.-]+)/g)) {
      if (!scriptNames.has(m[1])) {
        violations.push(`${where}: \`bun run ${m[1]}\` に対応する scripts が無い`);
      }
    }
    for (const m of line.matchAll(/AGENTS\.md の「([^」]+)」/g)) {
      if (!hasHeading(m[1])) {
        violations.push(`${where}: AGENTS.md に見出し「${m[1]}」が無い`);
      }
    }
  });
}

if (violations.length === 0) {
  console.log(`✅ 指示ファイルの参照整合: OK (${FILES.length} files)`);
  process.exit(0);
}
console.error("❌ 指示ファイルに実在しない参照があります(移動・改名したら参照も直す):");
for (const v of violations) {
  console.error(`  • ${v}`);
}
process.exit(1);
