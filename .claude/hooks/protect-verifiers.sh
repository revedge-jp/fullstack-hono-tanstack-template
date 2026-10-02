#!/usr/bin/env bash
# PreToolUse フック: 秘密情報(.env / .dev.vars)をエージェントの読み書き・検索から守る。
#
# 検証器(scripts/check/verifier-paths.txt)の編集はここでは止めない。以前はユーザー確認(ask)を出していたが、
# 内容を見ずに許可される運用になって作業を止めるだけだったため外した(#175)。検証器の緩和は CI の
# Review converged ジョブが PR 本文の「## 検証器の変更理由」を要求して受け止める。
#
# `.env` 系はエージェントが読む理由が無い(config は .env.example が正)ので deny。
# settings.json の permissions.deny ではなくここで行うのは、`.env.*` を deny しつつ
# `.env.example` だけ許可する例外が permissions では書けないため。
#
# 限界: Read / Edit / Write / MultiEdit / NotebookEdit / Grep ツールのパスだけを見る。Grep は `path` の名指しと、
# `glob` に .env / .dev.vars を含む指定を deny する。ripgrep はホワイトリストの glob（`*` 等）が gitignore を
# 上書きするので、`glob: "*"` のような広い指定では .env も検索対象になりうる(そこまでは塞がない)。Bash の sed / cat 経由は対象外
# (そこまで塞ぐと作業が成立しない)。
set -uo pipefail

# jq が無いとツールの入力を読めず、下の判定がすべて空になって .env の読み取りが通ってしまう。
# 判定できないときは止める側に倒す（JSON は jq を使わずに出す）
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"jq が見つからないため、秘密情報かどうかを判定できません。jq を入れてください（brew install jq）"}}'
  exit 0
fi

INPUT=$(cat)
GLOB=$(printf '%s' "$INPUT" | jq -r '.tool_input.glob // ""' 2>/dev/null || echo "")
# Grep ツールは glob を空白(JS の \s)で区切り、{} を含まない部分はカンマでも区切って rg の --glob に渡す。
# その分け方を bash で真似るのは近似にしかならず(\r・全角スペース・片側だけの { で食い違う)、並べ方で .env を
# 通してしまうので、分けずに判定する: .env / .dev.vars を含む glob はすべて deny し、例外は glob 全体が
# 区切り文字を含まない 1 つの「…/.env.example」だけ(除外指定 !.env と並べた形も止まるが、安全側に倒す)
GLOB_DENY=0
case "$GLOB" in
  *.env*|*.dev.vars*) GLOB_DENY=1 ;;
esac
if [ "$GLOB_DENY" = "1" ]; then
  # 文字列全体で判定する(grep は行ごとに一致するので、改行を挟んだ glob を通してしまう)。
  # 許す文字(英数字 _ . * / -)以外が 1 つでも残れば、区切りか細工とみなして deny のまま
  GLOB_REST=$(printf '%s' "$GLOB" | LC_ALL=C tr -d 'A-Za-z0-9_.*/-')
  case "$GLOB" in
    .env.example|*/.env.example) [ -z "$GLOB_REST" ] && GLOB_DENY=0 ;;
  esac
fi
if [ "$GLOB_DENY" = "1" ]; then
  jq -cn --arg r "glob「${GLOB}」は秘密情報(.env / .dev.vars)を検索対象にするため使いません。設定項目は .env.example を参照してください" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
fi
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // .tool_input.path // ""' 2>/dev/null || echo "")
[ -z "$FILE" ] && exit 0

# `./`・`..`・シンボリックリンクを解決してから判定する。文字列の前方一致だけだと apps/../.env の
# ような書き方で秘密情報の判定を避けられる。存在しないパス（Write の新規作成）も解決できるところまで解決する。
# リンクを辿る前の名前（.. だけ畳んだパス）でも判定する。辿った先の名前だけで見ると、別名のファイルへのリンクに
# なった .env が素通りする
resolve_path() {
  python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || printf '%s' "$1"
}
normalize_path() {
  python3 -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$1" 2>/dev/null || printf '%s' "$1"
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# 接頭辞「$2/」を大文字小文字を区別せずに取り除く（macOS の既定のファイルシステムでは大文字小文字違いも同じパス）
strip_prefix_ci() {
  local path="$1" prefix="$2/"
  case "$(lower "$path")" in
    "$(lower "$prefix")"*) printf '%s' "${path:${#prefix}}" ;;
    *) printf '%s' "$path" ;;
  esac
}

# CLAUDE_PROJECT_DIR はセッション起動時のメイン checkout のままで、worktree 作業中も変わらない。
# 別 checkout 配下のパスは git に root を聞き、worktree の接頭辞も落として root 相対に正規化する。
to_rel() { # $1 パス、$2 root
  local file="$1" rel top
  rel=$(strip_prefix_ci "$file" "$2")
  if [ "$rel" = "$file" ]; then
    top=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null || true)
    [ -n "$top" ] && rel=$(strip_prefix_ci "$file" "$top")
  fi
  case "$(lower "$rel")" in
    .claude/worktrees/*/*) rel="${rel#*/*/*/}" ;;
  esac
  printf '%s' "$rel"
}

REL=$(to_rel "$(resolve_path "$FILE")" "$(resolve_path "${CLAUDE_PROJECT_DIR:-$PWD}")")
RAW_REL=$(to_rel "$(normalize_path "$FILE")" "$(normalize_path "${CLAUDE_PROJECT_DIR:-$PWD}")")

emit() { # $1 decision, $2 reason
  jq -cn --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
}

for rel in "$RAW_REL" "$REL"; do
  case "$(lower "$(basename "$rel")")" in
    .env.example) ;;
    .env|.env.*|.dev.vars|.dev.vars.*)
      emit deny "$rel は秘密情報を含みうるため読み書きしません。設定項目は .env.example と docs/dev/environment-variables.md を参照してください"
      exit 0 ;;
  esac
done
exit 0
