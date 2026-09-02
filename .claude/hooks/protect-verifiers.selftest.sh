#!/usr/bin/env bash
# protect-verifiers.sh と is-verifier-path.sh の自己テスト。フックは JSON を stdin で受けて
# JSON を stdout に返すだけなので、代表ケースを流して decision を突き合わせる。
# arch-guards.selftest.sh から呼ばれる。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.claude/hooks/protect-verifiers.sh"
FAIL=0

expect() { # $1 label, $2 tool, $3 absolute path, $4 expected decision ("" = 素通り), $5 CLAUDE_PROJECT_DIR
  local out decision
  out=$(printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$2" "$3" | CLAUDE_PROJECT_DIR="$5" bash "$HOOK")
  decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null || echo "")
  if [ "$decision" = "$4" ]; then
    echo "✅ hook: $1"
  else
    echo "❌ hook: $1 (期待 '${4:-pass}' / 実際 '${decision:-pass}')"
    FAIL=1
  fi
}

expect "検証器の編集は ask" Edit "$ROOT/scripts/check/arch-guards.sh" ask "$ROOT"
expect "depcruise 設定の編集は ask" Write "$ROOT/dependency-cruiser.config.cjs" ask "$ROOT"
expect "CI ワークフローの編集は ask" Edit "$ROOT/.github/workflows/ci.yml" ask "$ROOT"
expect "フック自身の編集は ask" Edit "$ROOT/.claude/hooks/protect-verifiers.sh" ask "$ROOT"
expect "一覧ファイル自身の編集は ask" Edit "$ROOT/scripts/check/verifier-paths.txt" ask "$ROOT"
expect "検証器の Read は素通り" Read "$ROOT/scripts/check/arch-guards.sh" "" "$ROOT"
expect "通常ファイルの編集は素通り" Edit "$ROOT/apps/api-service/src/app.ts" "" "$ROOT"
# worktree: CLAUDE_PROJECT_DIR はメイン checkout のまま、file_path は worktree 配下
expect "worktree 配下の検証器も ask" Edit "$ROOT/.claude/worktrees/x/scripts/check/arch-guards.sh" ask "$ROOT"
# CLAUDE_PROJECT_DIR が別ディレクトリ(接頭辞不一致)でも git root から相対化して ask
expect "PROJECT_DIR 不一致でも ask" Edit "$ROOT/.oxlintrc.json" ask "/nonexistent/other"
expect "パスに引用符があっても JSON が壊れない" Edit "$ROOT/scripts/check/a\\\"b.sh" ask "$ROOT"
expect ".env の Read は deny" Read "$ROOT/.env" deny "$ROOT"
expect ".env.local の Edit は deny" Edit "$ROOT/.env.local" deny "$ROOT"
expect ".dev.vars の Read は deny" Read "$ROOT/apps/client/.dev.vars" deny "$ROOT"
expect ".env.example は素通り" Read "$ROOT/.env.example" "" "$ROOT"

out=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/.oxlintrc.json"}}' "$ROOT" | CLAUDE_PROJECT_DIR="$ROOT" CLAUDE_EVAL_DISABLE_VERIFIER_ASK=1 bash "$HOOK")
if [ -z "$out" ]; then echo "✅ hook: 評価用の無効化で ask が外れる"; else echo "❌ hook: 評価用の無効化が効かない"; FAIL=1; fi
out=$(printf '{"tool_name":"Read","tool_input":{"file_path":"%s/.env"}}' "$ROOT" | CLAUDE_PROJECT_DIR="$ROOT" CLAUDE_EVAL_DISABLE_VERIFIER_ASK=1 bash "$HOOK")
if printf '%s' "$out" | grep -q '"deny"'; then echo "✅ hook: 評価用の無効化でも deny は残る"; else echo "❌ hook: 評価用の無効化で deny まで外れた"; FAIL=1; fi

if bash "$ROOT/scripts/check/is-verifier-path.sh" apps/api-service/src/app.ts README.md >/dev/null; then
  echo "❌ is-verifier-path: 通常ファイルに一致してしまう"; FAIL=1
else
  echo "✅ is-verifier-path: 通常ファイルは不一致"
fi

exit $FAIL
