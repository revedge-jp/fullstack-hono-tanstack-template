#!/usr/bin/env bash
# protect-verifiers.sh と is-verifier-path.sh の自己テスト。フックは JSON を stdin で受けて
# JSON を stdout に返すだけなので、代表ケースを流して decision を突き合わせる。
# arch-guards.selftest.sh から呼ばれる。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.claude/hooks/protect-verifiers.sh"
FAIL=0

expect() { # $1 label, $2 tool, $3 absolute path, $4 expected decision ("" = 素通り), $5 CLAUDE_PROJECT_DIR, $6 入力キー(既定 file_path)
  local out decision
  out=$(printf '{"tool_name":"%s","tool_input":{"%s":"%s"}}' "$2" "${6:-file_path}" "$3" | CLAUDE_PROJECT_DIR="$5" bash "$HOOK")
  decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null || echo "")
  if [ "$decision" = "$4" ]; then
    echo "✅ hook: $1"
  else
    echo "❌ hook: $1 (期待 '${4:-pass}' / 実際 '${decision:-pass}')"
    FAIL=1
  fi
}

# 検証器の編集は確認を出さない(#175)。CI の Review converged が PR 本文の理由で受け止める
expect "検証器の編集は素通り" Edit "$ROOT/scripts/check/arch-guards.sh" "" "$ROOT"
expect "CI ワークフローの編集は素通り" Edit "$ROOT/.github/workflows/ci.yml" "" "$ROOT"
expect "ルート package.json の編集は素通り" Edit "$ROOT/package.json" "" "$ROOT"
expect "検証器の Read は素通り" Read "$ROOT/scripts/check/arch-guards.sh" "" "$ROOT"
expect "通常ファイルの編集は素通り" Edit "$ROOT/apps/api-service/src/app.ts" "" "$ROOT"
# worktree: CLAUDE_PROJECT_DIR はメイン checkout のまま、file_path は worktree 配下
expect "worktree 配下の .env も deny" Read "$ROOT/.claude/worktrees/x/.env" deny "$ROOT"
# CLAUDE_PROJECT_DIR が別ディレクトリ(接頭辞不一致)でも deny
expect "PROJECT_DIR 不一致でも deny" Read "$ROOT/.env" deny "/nonexistent/other"
expect "パスに引用符があっても JSON が壊れない" Read "$ROOT/a\\\"b/.env" deny "$ROOT"
expect ".env の Read は deny" Read "$ROOT/.env" deny "$ROOT"
expect ".env.local の Edit は deny" Edit "$ROOT/.env.local" deny "$ROOT"
expect ".dev.vars の Read は deny" Read "$ROOT/apps/client/.dev.vars" deny "$ROOT"
expect ".env.example は素通り" Read "$ROOT/.env.example" "" "$ROOT"
expect "Grep で .env を名指しすると deny" Grep "$ROOT/.env" deny "$ROOT" path
expect "Grep の通常パスは素通り" Grep "$ROOT/apps" "" "$ROOT" path
out=$(printf '{"tool_name":"Grep","tool_input":{"path":"%s","glob":".env*"}}' "$ROOT" | CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK")
if printf '%s' "$out" | grep -q '"deny"'; then echo "✅ hook: Grep の glob で .env を指定すると deny"; else echo "❌ hook: Grep の glob .env* が素通り"; FAIL=1; fi
for g in ".env.example" "apps/.env.example" "**/.env.example"; do
  out=$(printf '{"tool_name":"Grep","tool_input":{"glob":"%s"}}' "$g" | CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK")
  if [ -z "$out" ]; then echo "✅ hook: Grep の glob「${g}」は素通り"; else echo "❌ hook: Grep の glob「${g}」を止めた"; FAIL=1; fi
done
for g in ".env */.env.example" ".env,x/.env.example" ".dev.vars x/.env.example" "{.env,a/.env.example}" \
  "$(printf '.env\r*/.env.example')" '.env,x\\{/.env.example' "$(printf '.env\xe3\x80\x80*/.env.example')" \
  "$(printf '.env\n.env.example')"; do
  # 制御文字を含む glob もあるので JSON は jq で組み立てる（実際のペイロードと同じくエスケープされる）
  out=$(jq -cn --arg g "$g" '{tool_name:"Grep",tool_input:{glob:$g}}' | CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK")
  if printf '%s' "$out" | grep -q '"deny"'; then echo "✅ hook: Grep の glob「${g}」は deny"; else echo "❌ hook: Grep の glob「${g}」が素通り"; FAIL=1; fi
done
out=$(printf '{"tool_name":"Grep","tool_input":{"glob":"*.ts"}}' | CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK")
if [ -z "$out" ]; then echo "✅ hook: Grep の通常の glob は素通り"; else echo "❌ hook: Grep の glob *.ts を止めた"; FAIL=1; fi
expect "NotebookEdit も .env 系なら deny" NotebookEdit "$ROOT/.env.ipynb" deny "$ROOT" notebook_path

if bash "$ROOT/scripts/check/is-verifier-path.sh" apps/api-service/src/app.ts README.md >/dev/null; then
  echo "❌ is-verifier-path: 通常ファイルに一致してしまう"; FAIL=1
else
  echo "✅ is-verifier-path: 通常ファイルは不一致"
fi

exit $FAIL
