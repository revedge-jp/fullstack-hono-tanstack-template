#!/usr/bin/env node
// client の日本語文言チェック（.claude/rules/client.md「UI 文言の書き方」の機械検証部分）。
//
// 目的: AI が書く画面文言に出やすい語と言い回し（「効く」「シームレスな」「革命的な」等）を止める。
// 文法は正しく typecheck・lint・test をすべて通るので、画面で読むまで気づけない。
//
// 判定はルートの .textlintrc.json（AI 文章向けの 2 プリセットと、追加の辞書 scripts/check/ai-words.json）
// に任せ、このスクリプトは TS / TSX から文字列を取り出して渡すだけ。取り出すのは日本語を含む JSX テキストと
// 文字列リテラル（テンプレートリテラルは埋め込み式の間の部分ごと）。AST で読むのでコメントは対象外
// （画面に出ないため。行単位で読む client-styles.mjs はコメントも見る）。
//
// 全角ダッシュだけはここの正規表現で見る。kuromoji は前後の文字次第でダッシュを名詞 1 つにも記号 2 つにも
// 分けるため、辞書の形態素では拾えない。前後の空白の有無は問わない。
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { createLinter, loadTextlintrc } from "textlint";
import ts from "typescript";

import { collectClientSources } from "./client-sources.mjs";

const ROOTS = [
  "apps/client/app",
  "apps/client/features",
  "apps/client/components",
  "apps/client/shared",
];
const JAPANESE = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u;
// 文をつないでいるダッシュだけを拾う: 前が文字・閉じ括弧・句読点、後ろが文字・開き括弧。
// 「未設定（—）」や「──── または ────」は前後がこれに当たらないので対象外。前後とも数字の範囲表記
// （「1—3 件」）は isNumberRange で除く。
const DASH =
  /(?<=[\p{L}\p{N}\p{Pe}\p{Pf}。、！？!?.,])\s*[—―─⸺⸻]+\s*(?=[\p{L}\p{N}\p{Ps}\p{Pi}])/gu;
const DIGIT = /\p{N}/u;
const DASH_RULE_ID = "fullwidth-dash";
const DASH_MESSAGE =
  "全角ダッシュで文をつながないでください。句点で文を分けるか、読点・括弧を使ってください";

// 文字列の中身が始まる位置。JSX テキストは前後の空白ごと node.text に入るので pos から、
// リテラルは開きの記号（引用符・バッククォート・テンプレートの `}`）の次から。
function textStart(node, source) {
  if (ts.isJsxText(node)) {
    return node.pos;
  }
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.getStart(source) + 1;
  }
  return undefined;
}

function extractTexts(file) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const texts = [];
  const visit = (node) => {
    const start = textStart(node, source);
    if (start !== undefined && JAPANESE.test(node.text)) {
      texts.push({ file, source, start, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

// 列（0 始まり）から元ファイルの行を戻す。エスケープ（\n 等）を含む文字列では数文字ずれうるが、行の特定には足りる。
// 行は \n だけで数える。TypeScript の getLineAndCharacterOfPosition は U+2028/U+2029 も改行に数えるので、
// エディタや git の行番号とずれる。
function locate(entry, column) {
  const line = entry.source.text.slice(0, entry.start + column).split("\n").length;
  return `${relative(".", entry.file)}:${line}`;
}

function isNumberRange(text, match) {
  const before = text[match.index - 1] ?? "";
  const after = text[match.index + match[0].length] ?? "";
  return DIGIT.test(before) && DIGIT.test(after);
}

const files = collectClientSources(ROOTS, "scripts/check/ui-copy.mjs");
const texts = files.flatMap(extractTexts);

// 文字列 1 つを 1 段落（1 行）にして、lintText 1 回にまとめる（辞書の読み込みを 1 回で済ませるため）。
// 改行（行区切り文字を含む）は同じ長さの空白に置き換え、報告された列から元の位置を戻せるようにしている。
const document = texts.map((entry) => entry.text.replace(/[\r\n\u2028\u2029]/g, " ")).join("\n\n");
const descriptor = await loadTextlintrc({ configFilePath: ".textlintrc.json" });
const result = await createLinter({ descriptor }).lintText(document, "ui-copy.txt");

const violations = result.messages.map((message) => {
  const entry = texts[(message.line - 1) / 2];
  return {
    ruleId: message.ruleId,
    location: locate(entry, message.column - 1),
    message: message.message,
  };
});
for (const entry of texts) {
  for (const match of entry.text.matchAll(DASH)) {
    if (isNumberRange(entry.text, match)) {
      continue;
    }
    violations.push({
      ruleId: DASH_RULE_ID,
      location: locate(entry, match.index),
      message: DASH_MESSAGE,
    });
  }
}

if (violations.length === 0) {
  console.log(`OK（${texts.length} 件の文字列を検査）`);
  process.exit(0);
}

for (const ruleId of new Set(violations.map((violation) => violation.ruleId))) {
  console.log(`違反 [${ruleId}]`);
  for (const violation of violations.filter((hit) => hit.ruleId === ruleId)) {
    console.log(`  • ${violation.location}  ${violation.message}`);
  }
}
console.log("規約: .claude/rules/client.md「UI 文言の書き方」");
process.exit(1);
