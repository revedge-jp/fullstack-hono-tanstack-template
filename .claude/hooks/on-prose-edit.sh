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

# シンボリックリンク経由のパス（macOS の /tmp 等）でも git rev-parse --show-toplevel と比べられるよう、
# 実体のパスに解決する
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json, os
try:
    d = json.load(sys.stdin)
    path = d.get('tool_input', {}).get('file_path', '')
    print(os.path.realpath(path) if path else '')
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
    RC=$?
    # 指摘の有無は集計行（「✖ N problems」）で判断する。textlint はルールの例外でも 1 を返すので、終了コード
    # だけでは見分けられない。チェックを実行できないとき（node_modules が無い・例外等）は編集を止めない。
    # pre-push で同じチェックが走る
    if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qE '✖ [0-9]+ problems?'; then
      echo "AI が書く文章に出やすい表現が見つかりました（${REL}）。何がどうなるかを書く言葉に直してください（.claude/rules/general.md の「編集方針」）。" >&2
      printf '%s\n' "$OUT" >&2
      exit 2
    fi
    ;;
esac

exit 0
