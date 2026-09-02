#!/usr/bin/env bash
# /code-review・/security-review は $CLAUDE_PROJECT_DIR の現在ブランチを対象にする。
# worktree で実装した内容はそこに存在しないため、対象を明示しないと【別のブランチが
# 黙ってレビューされる】。エラーにはならず無関係な指摘が返るだけなので、結果を読むまで
# 気づけない（実際に繰り返し起きた事故）。
#
# 引数に PR 番号があれば安全（レビュー側が GitHub から差分を取る）。無い場合だけ、
# worktree が存在するかを見て警告を出す。
set -uo pipefail

INPUT=$(cat)

# ユーザーが打ったコマンド全文。取り出せない環境でも動くよう空文字にフォールバックする。
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // .command // ""' 2>/dev/null || echo "")

# 引数に数字（PR 番号）が含まれていれば対象は明示されている。
if printf '%s' "$PROMPT" | grep -qE '[0-9]{2,}'; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$PWD}"
CURRENT_BRANCH=$(git -C "$REPO" branch --show-current 2>/dev/null || echo "")

# メインの作業ディレクトリ以外で【実在する】worktree のブランチを列挙する。
# prunable（実体が消えた残骸）は過去のセッションのものが大量に残るので除外しないと
# 本命が埋もれる。porcelain は空行でレコードが区切られるので、レコード単位で判定する。
OTHER_WORKTREES=$(
  git -C "$REPO" worktree list --porcelain 2>/dev/null |
    awk -v repo="$REPO" '
      /^worktree /{ path = $2; branch = ""; prunable = 0 }
      /^branch /{ branch = $2; sub("refs/heads/", "", branch) }
      /^prunable/{ prunable = 1 }
      /^$/{ if (path != repo && branch != "" && !prunable) print branch; path = "" }
      END { if (path != repo && branch != "" && !prunable) print branch }
    ' |
    head -3
)

if [ -z "$OTHER_WORKTREES" ]; then
  exit 0
fi

BRANCH_LIST=$(printf '%s' "$OTHER_WORKTREES" | paste -sd ', ' -)

jq -n --arg current "$CURRENT_BRANCH" --arg others "$BRANCH_LIST" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptExpansion",
    additionalContext: (
      "【レビュー対象の確認】引数に PR 番号が無いので、このレビューは "
      + $current
      + " ブランチ（メインの作業ディレクトリ）が対象になる。"
      + "**直前にやっていた作業がこのブランチのものか、起動前に確かめること。**"
      + "worktree でも作業している場合、そちらの実装はここには存在せず、"
      + "エラーも出ないまま無関係なブランチがレビューされる（実際に発生した事故）。"
      + "別ブランチの例: " + $others + " 等。"
      + "対象がずれているなら `/code-review <level> <PR番号>` で明示する"
      + "（PR が無ければ Draft で先に作る）。詳細は .claude/rules/general.md の"
      + "「worktree で作業した実装のレビュー・検証」。"
    )
  }
}'
