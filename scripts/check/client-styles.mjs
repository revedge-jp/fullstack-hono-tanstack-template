#!/usr/bin/env node
// client のスタイル規約チェック（.claude/rules/client.md「デザイン規約」の機械検証部分）。
//
// 目的: AI が生成する UI の「デザインの漂流」を止める。1つずつは正しく動くため typecheck・lint・
// test をすべて通過し、画面を見るまで気づけない類の逸脱を検出する。
//  - semantic トークンの迂回（既定パレット・任意値・手書きの dark:）
//  - AI slop と呼ばれる定型の見た目（グラデーション・グラデーション文字・すりガラス・絵文字アイコン）
//
// 既定パレットは packages/tailwind-config/shared-styles.css で生成自体を止めているが、未定義の
// クラスはビルドエラーにならず黙って無色になるだけなので、ソース上の使用はここで検出する。
//
// components/ui（shadcn の生成物）は対象外: オーバーレイの半透明の黒や data-[...] 系の任意値を
// 正当に使い、shadcn CLI の更新で上書きされるため。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["apps/client/app", "apps/client/features", "apps/client/components"];
const EXCLUDED_DIRS = ["apps/client/components/ui"];
const EXCLUDED_FILES = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /routeTree\.gen\.ts$/];

const PALETTE_NAMES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const COLOR_UTILITIES =
  "bg|text|border|border-[xytrblse]|ring|ring-offset|outline|divide|shadow|inset-shadow|drop-shadow|decoration|accent|caret|placeholder|fill|stroke|from|via|to";
// クラス文字列の区切り（空白・引用符・バッククォート・中括弧）かバリアント（hover: 等）の直後だけを見る。
// 前置きの境界を要求しないと、`data-to-white` のような無関係な識別子まで拾う。
const CLASS_START = String.raw`(?<=^|[\s"'\x60{(:])`;

const RULES = [
  {
    id: "raw-palette",
    pattern: new RegExp(
      `${CLASS_START}-?(?:${COLOR_UTILITIES})-(?:${PALETTE_NAMES})(?:-\\d{2,3})?(?:\\/\\d+)?(?=$|[\\s"'\\x60}):])`,
      "g",
    ),
    message:
      "既定パレットの色は使えません。semantic トークン（text-muted-foreground / text-destructive / bg-primary 等）を使ってください",
  },
  {
    id: "arbitrary-value",
    // data-[state=open]: のような任意バリアント（直後が `:`）は対象外。
    pattern: new RegExp(`${CLASS_START}-?[a-z][a-z0-9-]*-\\[[^\\]\\s]+\\](?![:\\w-])`, "g"),
    message:
      "任意値（w-[347px] / bg-[#7c3aed] 等）は使えません。スケール（p-4 / gap-2 / text-sm）かトークンを使い、どうしても必要なら components/ に部品として切り出してください",
  },
  {
    id: "manual-dark-variant",
    pattern: new RegExp(`${CLASS_START}dark:`, "g"),
    message:
      "dark: を手書きしないでください。semantic トークンは .dark で値が切り替わるため、トークンを使えばダークモードは自動で対応します",
  },
  {
    id: "gradient",
    pattern: new RegExp(`${CLASS_START}-?bg-(?:linear|radial|conic|gradient)(?:-|\\b)`, "g"),
    message:
      "グラデーション背景は AI slop の代表例のため禁止です。単色の semantic トークン（bg-primary / bg-muted 等）を使ってください",
  },
  {
    id: "gradient-text",
    pattern: new RegExp(`${CLASS_START}bg-clip-text(?=$|[\\s"'\\x60}])`, "g"),
    message: "グラデーション文字（bg-clip-text）は AI slop の代表例のため禁止です",
  },
  {
    id: "glassmorphism",
    pattern: new RegExp(`${CLASS_START}backdrop-(?:blur|saturate|brightness)\\b`, "g"),
    message:
      "すりガラス（backdrop-blur 等）は AI slop の代表例のため禁止です。必要なオーバーレイは components/ui の部品を使ってください",
  },
  {
    id: "emoji",
    // Extended_Pictographic は © / ™ / ↔ まで含むため使わない。既定で絵文字表示になる文字と、
    // 異体字セレクタ（U+FE0F）で絵文字化した文字だけを拾う。
    pattern: /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu,
    message:
      "UI に絵文字を使わないでください（アイコン代わりの絵文字は AI slop の代表例）。アイコンは components.json の iconLibrary（lucide）の lucide-react を使ってください",
  },
];

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

function collectFiles(dir) {
  if (!isDir(dir) || EXCLUDED_DIRS.includes(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (isDir(path)) {
      return collectFiles(path);
    }
    if (!/\.tsx?$/.test(name) || EXCLUDED_FILES.some((re) => re.test(name))) {
      return [];
    }
    return [path];
  });
}

// ガードの説明コメント自体が禁止文字列を含んで引っかかるのを避けるため、コメント行は見ない。
const isCommentLine = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

const violations = [];
for (const file of ROOTS.flatMap(collectFiles)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (isCommentLine(line)) {
      return;
    }
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) {
        violations.push({ rule, location: `${relative(".", file)}:${index + 1}`, found: match[0] });
      }
    }
  });
}

if (violations.length === 0) {
  console.log("OK");
  process.exit(0);
}

for (const rule of RULES) {
  const hits = violations.filter((violation) => violation.rule === rule);
  if (hits.length === 0) {
    continue;
  }
  console.log(`違反 [${rule.id}]: ${rule.message}`);
  for (const hit of hits) {
    console.log(`  • ${hit.location}  ${hit.found}`);
  }
}
console.log("規約: .claude/rules/client.md「デザイン規約」");
process.exit(1);
