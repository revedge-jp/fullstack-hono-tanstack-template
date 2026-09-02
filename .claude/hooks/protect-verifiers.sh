#!/usr/bin/env bash
# PreToolUse フック: 検証器と秘密情報をエージェントの「気軽な編集・閲覧」から守る。
#
# 背景: エージェントがゲートに引っかかったとき、最短経路は「コードを直す」ではなく
# 「ゲートを緩める」(閾値を下げる・除外を足す・ガードを消す)になりがちで、lint も
# テストも通ったまま検証能力だけが静かに落ちる。ここでは検証器の編集を「禁止」ではなく
# 「ユーザー確認(ask)」にして、緩和が人の目を通らずに入らないようにする。
# `.env` 系はエージェントが読む理由が無い(config は .env.example が正)ので deny。
#
# 限界: Edit / Write / Read ツールのパスだけを見る。Bash の sed / cat 経由は対象外
# (そこまで塞ぐと作業が成立しない)。守りの本体は pre-push / CI 側の検証で、これは第一線。
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")
[ -z "$FILE" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
REL="${FILE#"$ROOT"/}"
BASE=$(basename "$REL")

emit() { # $1 decision, $2 reason
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"
}

# 秘密情報: どのツールでも deny(.env.example だけは設定の正典なので許可)
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

is_verifier=0
case "$REL" in
  scripts/check/*|.github/workflows/*|.claude/hooks/*) is_verifier=1 ;;
  dependency-cruiser.config.cjs|.oxlintrc.json|lefthook.yml|.jscpd.json|knip.json|turbo.json|bunfig.toml|renovate.json|commitlint.config.mjs|.claude/settings.json|.github/security-audit-allowlist.json) is_verifier=1 ;;
  apps/*/stryker.conf.*|apps/*/stryker.config.*|apps/*/.jscpd.json) is_verifier=1 ;;
esac

if [ "$is_verifier" = "1" ]; then
  emit ask "$REL は検証器(ゲート・ガード・CI・フック)です。閾値の引き下げ・除外の追加・ガードの削除はコードを直す代わりになっていないか確認してください。意図した変更なら許可し、PR 本文に理由を書いてください"
  exit 0
fi
exit 0
