#!/usr/bin/env node
// 指示ファイル(AGENTS.md / CLAUDE.md / REVIEW.md / apps/*/AGENTS.md / apps/*/CLAUDE.md /
// .claude/rules / .claude/commands)と、人向けのドキュメント(README.md / docs/** / apps/*・packages/* の
// README)の参照整合チェック。ドキュメントを対象外にしていた頃は、旧構成のまま古くなったガイドが
// ゲートを素通りし、エージェントの写経元になっていた。
//
// 目的: 指示ファイルはコードと違って lint も typecheck も効かないため、ファイル移動・スクリプト改名・
// 見出し変更で参照が黙って腐る。腐った参照はエージェントに「存在しないヘルパを探す」「無い
// コマンドを叩く」をさせ、写経や独自実装の起点になる。ここでは 3 種類の参照を実在確認する:
//  1. バッククォート内のパス(`scripts/check/foo.sh`、`../../AGENTS.md` 等)
//  2. `bun run <script>` の <script> が package.json(ルート or apps/*)の scripts に存在する
//  3. `AGENTS.md の「見出し」` 形式の見出し参照が、名指しされた AGENTS.md に存在する。裸の
//     `AGENTS.md` はルート、`apps/client/AGENTS.md` のようにパス付きなら参照元ファイルからの相対 →
//     ルート相対の順で解決する(パスはバッククォートで囲んでもよい。「」は連続で複数書ける)
//  4. Markdown の相対リンク `[..](path)` のリンク先が実在する(アンカーは見ない)
// 誤検出を避けるため、glob(* ? { })・プレースホルダ(<xxx> / {xxx} / Xxx)・URL は対象外。
// 実在しないパスのうち gitignore 対象のもの(ビルド成果物・.dev.vars 等の生成物)も対象外。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const APPS = readdirSync(join(ROOT, "apps"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const PACKAGES = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const markdownUnder = (dir) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${dir}/${f}`);
const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "REVIEW.md",
  "README.md",
  ...APPS.map((app) => `apps/${app}/AGENTS.md`),
  ...APPS.map((app) => `apps/${app}/CLAUDE.md`),
  ...APPS.map((app) => `apps/${app}/README.md`),
  "apps/client/shared/README.md",
  ...PACKAGES.map((pkg) => `packages/${pkg}/README.md`),
  ...readdirSync(join(ROOT, ".claude/rules")).map((f) => `.claude/rules/${f}`),
  ...readdirSync(join(ROOT, ".claude/commands")).map((f) => `.claude/commands/${f}`),
  ...markdownUnder("docs"),
].filter((f) => existsSync(join(ROOT, f)));

// gitignore 対象(生成物)は実在しなくても参照してよい。1 回の git 呼び出しでまとめて判定する。
// リポジトリ外のパスを 1 件でも渡すと git が fatal で全体を失敗させるので、ルート配下のものだけ渡す
const gitIgnored = (paths) => {
  const inside = [...new Set(paths)].filter((p) => p !== "" && !p.startsWith(".."));
  if (inside.length === 0) {
    return new Set();
  }
  try {
    const out = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
      cwd: ROOT,
      input: inside.join("\n"),
      encoding: "utf8",
    });
    return new Set(out.split("\n").filter(Boolean));
  } catch (error) {
    // exit 1 は「1 件も ignore 対象でない」。それ以外(git の失敗)を握りつぶすと除外が黙って効かなくなる
    if (error.status === 1) {
      return new Set();
    }
    throw error;
  }
};

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
const headingsByFile = new Map();
const headingsOf = (file) => {
  if (!headingsByFile.has(file)) {
    headingsByFile.set(file, collectHeadings(readFileSync(file, "utf8")));
  }
  return headingsByFile.get(file);
};
// 「Testing」が「Testing Conventions」に一致しないよう、完全一致か「見出し (補足)」の補足省略だけ許す
const hasHeading = (file, name) =>
  headingsOf(file).some((h) => h === name || h.startsWith(`${name} (`));
// apps/*/AGENTS.md の中で裸の `AGENTS.md` と書いてもルートを指す(参照元自身と取り違えない)
const resolveAgentsFile = (ref, dir) =>
  ref.includes("/")
    ? [resolve(dir, ref), join(ROOT, ref)].find((c) => existsSync(c))
    : join(ROOT, "AGENTS.md");

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
// 実在しないパス(gitignore 判定は最後にまとめて行う): [参照元, 表示用トークン, 候補のルート相対パス[]]。
// 候補(参照元相対・ルート相対 等)のどれか 1 つでも gitignore 対象なら生成物への参照とみなす
const missingPaths = [];
for (const file of FILES) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const dir = dirname(join(ROOT, file));
  const lines = text.split("\n");
  let inFence = false;
  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
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
        missingPaths.push([where, `\`${token}\``, candidates.map((c) => relative(ROOT, c))]);
      }
    }
    // Markdown のリンク。コードフェンスとインラインコードの中(handlers[type](payload) 等)は見ない。
    // `[a](<x y.md>)` と `[a](x.md "title")` の形も読み、%エンコードは戻してから確かめる
    const prose = inFence ? "" : line.replace(/`[^`]*`/g, "");
    for (const m of prose.matchAll(/\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) {
      let target = (m[1] ?? m[2]).replace(/#.*$/, "");
      if (target === "" || /^[a-z]+:/i.test(target)) {
        continue;
      }
      try {
        target = decodeURI(target);
      } catch {
        // 不正な %エンコードはそのまま確かめる
      }
      // `/` 始まりは GitHub と同じくリポジトリのルート基準
      const full = target.startsWith("/") ? join(ROOT, target) : resolve(dir, target);
      if (!existsSync(full)) {
        missingPaths.push([where, `リンク先 ${target}`, [relative(ROOT, full)]]);
      }
    }
    // `bun run db:*` のような glob 表記は対象外(直後が * のものを読み飛ばす)
    for (const m of line.matchAll(/`bun run ([\w:.-]+)(?![\w:.*-])/g)) {
      if (!scriptNames.has(m[1])) {
        violations.push(`${where}: \`bun run ${m[1]}\` に対応する scripts が無い`);
      }
    }
    for (const m of line.matchAll(/`?((?:[\w.-]+\/)*AGENTS\.md)`? の((?:「[^」]+」)+)/g)) {
      const target = resolveAgentsFile(m[1], dir);
      if (!target) {
        violations.push(`${where}: \`${m[1]}\` が実在しない`);
        continue;
      }
      const label = relative(ROOT, target);
      for (const [, name] of m[2].matchAll(/「([^」]+)」/g)) {
        if (!hasHeading(target, name)) {
          violations.push(`${where}: ${label} に見出し「${name}」が無い`);
        }
      }
    }
  });
}

const ignored = gitIgnored(missingPaths.flatMap(([, , paths]) => paths));
for (const [where, label, paths] of missingPaths) {
  if (!paths.some((path) => ignored.has(path))) {
    violations.push(`${where}: ${label} が実在しない`);
  }
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
