#!/bin/bash
# 文書が編集されたら、AI が書く文章に出やすい語（「効く」「正典」等）・誇張・冗長な言い回しを
# その場でチェックし、指摘を Claude に返す（exit 2。編集自体は取り消されない）。
# pre-push（check-all の Prose）でも同じチェックが走るが、そこまで待つと文言をまとめて書いた後で
# 直すことになるので、書いた直後に知らせる。
#
# client の TS / TSX の画面文言は on-ts-edit.sh が整形の後に続けてチェックする。PostToolUse のフックは
# 並列に走るので、ここで見ると oxfmt が書き換えている最中のファイルを読みうるため。
#
# 対象の範囲は package.json の lint:prose に揃える。変えたらここも直す。

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

[ -f "$FILE_PATH" ] || exit 0

# worktree で編集したファイルは CLAUDE_PROJECT_DIR（main のチェックアウト）の外にあるので、
# ファイル自身の場所からリポジトリのルートを求める
ROOT=$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REL="${FILE_PATH#"$ROOT"/}"

case "$REL" in
  AGENTS.md | REVIEW.md | apps/*/AGENTS.md | .claude/rules/*.md | .claude/commands/*.md | docs/*.md)
    OUT=$(cd "$ROOT" && ./node_modules/.bin/textlint "$REL" 2>&1)
    # textlint は指摘ありで 1、設定の読み込み失敗などで 2 を返す。チェックを実行できないとき
    # （node_modules が無い等）は編集を止めない。pre-push で同じチェックが走る
    if [ $? -eq 1 ]; then
      echo "AI が書く文章に出やすい表現が見つかりました（${REL}）。何がどうなるかを書く言葉に直してください（.claude/rules/general.md の「編集方針」）。" >&2
      printf '%s\n' "$OUT" >&2
      exit 2
    fi
    ;;
esac

exit 0
