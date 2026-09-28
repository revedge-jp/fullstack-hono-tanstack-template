#!/usr/bin/env node
// client の日本語文言チェック（.claude/rules/client.md「UI 文言の書き方」の機械検証部分）。
//
// 目的: AI が書く画面文言に出やすい語と言い回し（「効く」「シームレスな」「革命的な」等）を止める。
// 文法は正しく typecheck・lint・test をすべて通るので、画面で読むまで気づけない。
//
// 判定は 2 つの textlint 設定に任せ、このスクリプトは TS / TSX から文字列を取り出して渡すだけ。
//  - ルートの .textlintrc.json: AI 文章向けの 2 プリセットと、追加の辞書 scripts/check/ai-words.json。docs の
//    lint:prose と共有している
//  - scripts/check/ui-copy.textlintrc.json: 画面の文言だけに当てるもの。表記の辞書 scripts/check/ui-terms.yml
//    （SmartHR Design System の用字用語。「ログイン」→「サインイン」等）と、和文の空白の規則（英数字の前後に
//    空白を入れない等）。docs は英単語の前後に空白を入れる書き方なので、ルートの設定には入れられない
//取り出すのは日本語を含む JSX テキストと
// 文字列リテラル（テンプレートリテラルは埋め込み式の間の部分ごと）。AST で読むのでコメントは対象外
// （画面に出ないため。行単位で読む client-styles.mjs はコメントも見る）。
//
// 全角ダッシュだけはここの正規表現で見る。kuromoji は前後の文字次第でダッシュを名詞 1 つにも記号 2 つにも
// 分けるため、辞書の形態素では拾えない。前後の空白の有無は問わない。
//
// 文言の置き場所で形が決まる規則は AST で見る（textlint には置き場所が渡らないため）:
//  - page-title: ルートの head の meta: [{ title }] は「画面名｜アプリ名」
//  - button-label: <Button> の中の文言は動詞の終止形で「〜する」を省く（「追加する」ではなく「追加」）
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

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
const UI_TEXTLINTRC = "scripts/check/ui-copy.textlintrc.json";
const DASH_RULE_ID = "fullwidth-dash";
const DASH_MESSAGE =
  "全角ダッシュで文をつながないでください。句点で文を分けるか、読点・括弧を使ってください";

// 縦棒 1 本で 2 つに分かれ、縦棒の前後に空白が無いもの。日本語を含まない title（アプリ名だけ等）は見ない。
const PAGE_TITLE = /^[^｜\s](?:[^｜]*[^｜\s])?｜[^｜\s](?:[^｜]*[^｜\s])?$/u;
const PAGE_TITLE_RULE_ID = "page-title";
const PAGE_TITLE_MESSAGE =
  "ページの title は「画面名｜アプリ名」の形にしてください（全角の縦棒で区切り、前後に空白を入れない）";
// サ変動詞の「する」を残したもの・丁寧形・句点。「取り消す」「次へ進める」のような終止形は通す。
const BUTTON_LABEL_NG = /(?:する|します|しましょう|。)$/u;
const BUTTON_LABEL_RULE_ID = "button-label";
const BUTTON_LABEL_MESSAGE =
  "ボタンのラベルは動詞の終止形にし、「〜する」を省いてください（「追加する」は「追加」、「タスクを追加する」は「タスクを追加」）。句点も付けません";

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

function propertyName(node) {
  return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ? node.name.text
    : undefined;
}

// head: () => ({ meta: [{ title: "..." }] }) の title。
function isMetaTitle(node) {
  if (!ts.isPropertyAssignment(node) || propertyName(node) !== "title") {
    return false;
  }
  const array = node.parent?.parent;
  return (
    array !== undefined &&
    ts.isArrayLiteralExpression(array) &&
    ts.isPropertyAssignment(array.parent) &&
    propertyName(array.parent) === "meta"
  );
}

// <Button> の子に直接書いた文言と、子の式の中の文字列（{pending ? "送信中…" : "送信"}）。
function buttonLabelNodes(element) {
  const labels = [];
  const collect = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      labels.push(node);
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      return;
    }
    ts.forEachChild(node, collect);
  };
  for (const child of element.children) {
    if (ts.isJsxText(child)) {
      labels.push(child);
    } else if (ts.isJsxExpression(child) && child.expression) {
      collect(child.expression);
    }
  }
  return labels;
}

function lineOf(source, node) {
  return source.text.slice(0, node.getStart(source)).split("\n").length;
}

// 置き場所で形が決まる文言（title とボタン）の違反。
function checkPlacement(file, source) {
  const found = [];
  const visit = (node) => {
    if (
      isMetaTitle(node) &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      JAPANESE.test(node.initializer.text) &&
      !PAGE_TITLE.test(node.initializer.text)
    ) {
      found.push({
        ruleId: PAGE_TITLE_RULE_ID,
        location: `${relative(".", file)}:${lineOf(source, node)}`,
        message: `${PAGE_TITLE_MESSAGE}: ${node.initializer.text}`,
      });
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Button") {
      for (const label of buttonLabelNodes(node)) {
        const text = label.text.trim();
        if (JAPANESE.test(text) && BUTTON_LABEL_NG.test(text)) {
          found.push({
            ruleId: BUTTON_LABEL_RULE_ID,
            location: `${relative(".", file)}:${lineOf(source, label)}`,
            message: `${BUTTON_LABEL_MESSAGE}: ${text}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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
      // JSX テキストの前後の空白（改行とインデント）は画面に出ないので外す。残すと和文の空白の規則
      // （括弧の前に空白を入れない等）が、書いていない空白を違反として拾う
      const leading = ts.isJsxText(node) ? node.text.length - node.text.trimStart().length : 0;
      const text = ts.isJsxText(node) ? node.text.trim() : node.text;
      texts.push({ file, source, start: start + leading, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { texts, placementViolations: checkPlacement(file, source) };
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

// 引数にファイルを渡すと、そのうち走査対象に入るものだけを見る（編集直後に呼ぶ .claude/hooks/on-ts-edit.sh 用）。
// 対象外のファイルだけなら何も見ずに成功する。シンボリックリンク経由のパス（macOS の /tmp 等）でも
// 一致するよう、実体のパスに解決してから比べる（process.cwd() は解決済みのパスを返す）。
const toRealPath = (arg) => (existsSync(arg) ? realpathSync(arg) : resolve(arg));
const requested = new Set(process.argv.slice(2).map((arg) => relative(".", toRealPath(arg))));
const sources = collectClientSources(ROOTS, "scripts/check/ui-copy.mjs");
const files =
  requested.size === 0 ? sources : sources.filter((file) => requested.has(relative(".", file)));
const extracted = files.map(extractTexts);
const texts = extracted.flatMap((entry) => entry.texts);

// 文字列 1 つを 1 段落（1 行）にして、lintText 1 回にまとめる（辞書の読み込みを 1 回で済ませるため）。
// 改行（行区切り文字を含む）は同じ長さの空白に置き換え、報告された列から元の位置を戻せるようにしている。
const document = texts.map((entry) => entry.text.replace(/[\r\n\u2028\u2029]/g, " ")).join("\n\n");
const lintWith = async (configFilePath) => {
  const descriptor = await loadTextlintrc({ configFilePath });
  const result = await createLinter({ descriptor }).lintText(document, "ui-copy.txt");
  return result.messages;
};
const messages = [...(await lintWith(".textlintrc.json")), ...(await lintWith(UI_TEXTLINTRC))];

const violations = messages.map((message) => {
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
violations.push(...extracted.flatMap((entry) => entry.placementViolations));

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
