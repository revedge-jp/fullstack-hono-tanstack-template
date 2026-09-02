#!/usr/bin/env bash
# PreToolUse フック: 検証器と秘密情報をエージェントの「気軽な編集・閲覧」から守る。
#
# 背景: エージェントがゲートに引っかかったとき、最短経路は「コードを直す」ではなく
# 「ゲートを緩める」(閾値を下げる・除外を足す・ガードを消す)になりがちで、lint も
# テストも通ったまま検証能力だけが静かに落ちる。ここでは検証器の編集を「禁止」ではなく
# 「ユーザー確認(ask)」にして、緩和が人の目を通らずに入らないようにする。
# 対象パスは scripts/check/verifier-paths.txt が正典(CI の verifier-change ジョブと共有)。
#
# `.env` 系はエージェントが読む理由が無い(config は .env.example が正)ので deny。
# settings.json の permissions.deny ではなくここで行うのは、`.env.*` を deny しつつ
# `.env.example` だけ許可する例外が permissions では書けないため。
#
# 限界: Edit / Write / Read ツールのパスだけを見る。Bash の sed / cat 経由は対象外
# (そこまで塞ぐと作業が成立しない)。Bash 迂回・他エージェント・手編集は CI の
# verifier-change ジョブ(PR 本文に理由を要求)が同じ一覧で受け止める。
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")
[ -z "$FILE" ] && exit 0

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
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

case "$BASE" in
  .env.example) ;;
  .env|.env.*|.dev.vars|.dev.vars.*)
    emit deny "$REL は秘密情報を含みうるため読み書きしません。設定項目は .env.example と docs/dev/environment-variables.md を参照してください"
    exit 0 ;;
esac

case "$TOOL" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

# evals/ の A/B 比較(フックの効果測定)専用。環境変数はセッション起動時に決まり、エージェントの
# Bash からフック自身の環境は変えられない。deny(秘密情報)には効かない
if [ "${CLAUDE_EVAL_DISABLE_VERIFIER_ASK:-}" = "1" ]; then exit 0; fi

if bash "$HOOK_DIR/../../scripts/check/is-verifier-path.sh" "$REL" >/dev/null; then
  emit ask "$REL は検証器(ゲート・ガード・CI・フック)です。閾値の引き下げ・除外の追加・ガードの削除はコードを直す代わりになっていないか確認してください。意図した変更なら許可し、PR 本文の「## 検証器の変更理由」に理由を書いてください(CI が要求します)"
fi
exit 0
