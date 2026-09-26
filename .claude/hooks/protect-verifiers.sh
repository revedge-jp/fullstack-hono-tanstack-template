#!/usr/bin/env bash
# PreToolUse フック: 検証器と秘密情報をエージェントの「気軽な編集・閲覧」から守る。
#
# 背景: エージェントがゲートに引っかかったとき、最短経路は「コードを直す」ではなく
# 「ゲートを緩める」(閾値を下げる・除外を足す・ガードを消す)になりがちで、lint も
# テストも通ったまま検証能力だけが静かに落ちる。ここでは検証器の編集を「禁止」ではなく
# 「ユーザー確認(ask)」にして、緩和が人の目を通らずに入らないようにする。
# 対象パスは scripts/check/verifier-paths.txt が正典(CI の Review converged ジョブと共有)。
#
# `.env` 系はエージェントが読む理由が無い(config は .env.example が正)ので deny。
# settings.json の permissions.deny ではなくここで行うのは、`.env.*` を deny しつつ
# `.env.example` だけ許可する例外が permissions では書けないため。
#
# 限界: Edit / Write / MultiEdit / NotebookEdit / Read / Grep ツールのパスだけを見る。Grep は `path` の名指しと、
# `glob` に .env / .dev.vars を含む指定を deny する。ripgrep はホワイトリストの glob（`*` 等）が gitignore を
# 上書きするので、`glob: "*"` のような広い指定では .env も検索対象になりうる(そこまでは塞がない)。Bash の sed / cat 経由は対象外
# (そこまで塞ぐと作業が成立しない)。Bash 迂回・他エージェント・手編集は CI の
# Review converged ジョブ(PR 本文に理由を要求。判定は base 側の一覧)が同じ一覧で受け止める。
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
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

# `./`・`..`・シンボリックリンクを解決してから判定する。文字列の前方一致だけだと apps/../scripts/check/x.sh の
# ような書き方で検証器・秘密情報の判定を避けられる。存在しないパス（Write の新規作成）も解決できるところまで解決する
resolve_path() {
  python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || printf '%s' "$1"
}
FILE=$(resolve_path "$FILE")

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(resolve_path "${CLAUDE_PROJECT_DIR:-$PWD}")
REL="${FILE#"$ROOT"/}"
# CLAUDE_PROJECT_DIR はセッション起動時のメイン checkout のままで、worktree 作業中も変わらない。
# 別 checkout 配下のパスは git に root を聞き、worktree の接頭辞も落として root 相対に正規化する。
if [ "$REL" = "$FILE" ]; then
  TOP=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$TOP" ] && REL="${FILE#"$TOP"/}"
fi
REL="${REL#.claude/worktrees/*/}"
BASE=$(basename "$REL")

emit() { # $1 decision, $2 reason
  jq -cn --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
}

# 大文字小文字は区別しない（macOS の既定のファイルシステムでは .ENV も .env と同じファイル）
BASE_LOWER=$(printf '%s' "$BASE" | tr '[:upper:]' '[:lower:]')
case "$BASE_LOWER" in
  .env.example) ;;
  .env|.env.*|.dev.vars|.dev.vars.*)
    emit deny "$REL は秘密情報を含みうるため読み書きしません。設定項目は .env.example と docs/dev/environment-variables.md を参照してください"
    exit 0 ;;
esac

case "$TOOL" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

# evals/ の A/B 比較(フックの効果測定)専用。環境変数はセッション起動時に決まり、エージェントの
# Bash からフック自身の環境は変えられない。deny(秘密情報)には効かない
if [ "${CLAUDE_EVAL_DISABLE_VERIFIER_ASK:-}" = "1" ]; then exit 0; fi

if bash "$HOOK_DIR/../../scripts/check/is-verifier-path.sh" "$REL" >/dev/null; then
  emit ask "$REL は検証器(ゲート・ガード・CI・フック)です。閾値の引き下げ・除外の追加・ガードの削除はコードを直す代わりになっていないか確認してください。意図した変更なら許可し、PR 本文の「## 検証器の変更理由」に理由を書いてください(CI が要求します)"
fi
exit 0
