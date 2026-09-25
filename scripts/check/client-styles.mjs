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
// コメントも全規則で検査する（絵文字を含む）。禁止クラス名を含むコメントは「旧クラスはこうだった」という変更履歴で、
// 履歴は git に残るため書かない（旧実装の説明が要るなら言葉で書く）。行単位の走査でコメントと
// 文字列・JSX テキストを見分けるのは原理的に近似にしかならず、見逃しと誤検出を行き来するため、
// 除外する仕組み自体を持たない。
//
// components/ui（shadcn の生成物）は対象外: オーバーレイの半透明の黒や data-[...] 系の任意値を
// 正当に使い、shadcn CLI の更新で上書きされるため。
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { collectClientSources } from "./client-sources.mjs";

const ROOTS = ["apps/client/app", "apps/client/features", "apps/client/components"];

const PALETTE_NAMES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const COLOR_UTILITIES =
  "bg|text|border|border-[xytrblse]|ring|ring-offset|outline|divide|shadow|inset-shadow|drop-shadow|decoration|accent|caret|placeholder|fill|stroke|from|via|to";
// クラス文字列の区切り（空白・引用符・バッククォート・中括弧）かバリアント（hover: 等）の直後だけを見る。
// 前置きの境界を要求しないと、`data-to-white` のような無関係な識別子まで拾う。
// 前置きの `!`（v3 形式の important）はクラスの一部として読み飛ばす。
const CLASS_START = String.raw`(?<=^|[\s"'\x60{(:])!?`;
// クラスの終わり。末尾の `!`（v4 形式の important）を許す。
const CLASS_END = String.raw`!?(?=$|[\s"'\x60}):])`;

const RULES = [
  {
    id: "raw-palette",
    pattern: new RegExp(
      `${CLASS_START}-?(?:${COLOR_UTILITIES})-(?:${PALETTE_NAMES})(?:-\\d{2,3})?(?:\\/(?:\\d+|\\[[^\\]\\s]+\\]|\\([^)\\s]+\\)))?${CLASS_END}`,
      "g",
    ),
    message:
      "既定パレットの色は使えません。semantic トークン（text-muted-foreground / text-destructive / bg-primary 等）を使ってください",
  },
  {
    id: "arbitrary-value",
    // w-[347px] と、v4 の CSS 変数省略記法 bg-(--brand) / text-(color:--brand) の両方。
    // data-[state=open]: のような任意バリアント（直後が `:`）は対象外。
    pattern: new RegExp(
      `${CLASS_START}-?[a-z][a-z0-9-]*-(?:\\[[^\\]\\s]+\\]|\\((?:[a-z-]+:)?--[^)\\s]+\\))(?![:\\w-])`,
      "g",
    ),
    message:
      "任意値（w-[347px] / bg-[#7c3aed] 等）は使えません。スケール（p-4 / gap-2 / text-sm）かトークンを使い、どうしても必要なら components/ に部品として切り出してください",
  },
  {
    id: "arbitrary-property",
    // [color:#7c3aed] / [background:linear-gradient(...)] は他の全規則を迂回できる。
    // [&>svg]:size-4 のような任意バリアント（直後が `:`）は対象外。
    pattern: new RegExp(`${CLASS_START}\\[[a-z-]+:[^\\]\\s]+\\](?![:\\w-])`, "g"),
    message:
      "任意プロパティ（[color:#7c3aed] / [background:linear-gradient(...)] 等）は使えません。トークンとスケールのクラスを使ってください",
  },
  {
    id: "margin-spacing",
    // 間隔は親の gap-* / 部品の padding で作る。子の margin と space-* は、並びや条件付き描画が
    // 変わると間隔が崩れ、部品ごとに間隔の作り方がばらつく。mx-auto 等の auto は対象外。
    // 論理プロパティ版（ms / me / mbs / mbe）も含む（Tailwind 4.3 の margin ユーティリティ全種）。
    pattern: new RegExp(
      `${CLASS_START}-?(?:m(?:bs|be|[trblxyse])?|space-[xy])-(?:\\d+(?:\\.\\d+)?|px)${CLASS_END}`,
      "g",
    ),
    message:
      "margin（mt-2 / -mx-4 等）と space-y-* / space-x-* で間隔を作らないでください。親の flex / grid + gap-* か、部品の padding で作ってください（mx-auto 等の auto は可）",
  },
  {
    id: "manual-dark-variant",
    // `{ dark: "Dark" }` のようなオブジェクトキーを拾わないよう、直後が区切りのものは除く
    // （2xl: や @md: のように数字・記号で始まるバリアントが続く形は拾う）。
    pattern: new RegExp(`${CLASS_START}dark:(?![\\s"'\\x60}]|$)`, "g"),
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
    id: "raw-page-heading",
    // ページ見出しのサイズ・太さを PageHeader に閉じ込める。直書きの h1 はページごとに
    // 書き方がばらつく（派生プロダクトの実測で h1 の class が 5 通りに分かれていた）。
    pattern: /<h1\b/g,
    allowedIn: ["apps/client/components/patterns/page-header.tsx"],
    message:
      "h1 を直接書かないでください。ページ見出しは @/components/patterns/page-header の PageHeader を使ってください",
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

const files = collectClientSources(ROOTS, "scripts/check/client-styles.mjs");

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.allowedIn?.includes(file)) {
        continue;
      }
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
