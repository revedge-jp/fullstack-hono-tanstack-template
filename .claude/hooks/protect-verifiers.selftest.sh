#!/usr/bin/env bash
# protect-verifiers.sh の自己テスト。フックは JSON を stdin で受けて JSON を stdout に返すだけ
# なので、代表ケースを流して decision を突き合わせる。arch-guards.selftest.sh から呼ばれる。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.claude/hooks/protect-verifiers.sh"
FAIL=0

expect() { # $1 label, $2 tool, $3 path, $4 expected decision ("" = 素通り)
  local out decision
  out=$(printf '{"tool_name":"%s","tool_input":{"file_path":"%s/%s"}}' "$2" "$ROOT" "$3" | CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK")
  decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null || echo "")
  if [ "$decision" = "$4" ]; then
    echo "✅ hook: $1"
  else
    echo "❌ hook: $1 (期待 '${4:-pass}' / 実際 '${decision:-pass}')"
    FAIL=1
  fi
}

expect "検証器の編集は ask" Edit scripts/check/arch-guards.sh ask
expect "depcruise 設定の編集は ask" Write dependency-cruiser.config.cjs ask
expect "CI ワークフローの編集は ask" Edit .github/workflows/ci.yml ask
expect "フック自身の編集は ask" Edit .claude/hooks/protect-verifiers.sh ask
expect "検証器の Read は素通り" Read scripts/check/arch-guards.sh ""
expect "通常ファイルの編集は素通り" Edit apps/api-service/src/app.ts ""
expect ".env の Read は deny" Read .env deny
expect ".env.local の Edit は deny" Edit .env.local deny
expect ".dev.vars の Read は deny" Read apps/client/.dev.vars deny
expect ".env.example は素通り" Read .env.example ""

exit $FAIL
