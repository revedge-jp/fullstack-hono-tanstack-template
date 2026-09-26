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

expect "検証器の編集は ask" Edit "$ROOT/scripts/check/arch-guards.sh" ask "$ROOT"
expect "depcruise 設定の編集は ask" Write "$ROOT/dependency-cruiser.config.cjs" ask "$ROOT"
expect "CI ワークフローの編集は ask" Edit "$ROOT/.github/workflows/ci.yml" ask "$ROOT"
expect "フック自身の編集は ask" Edit "$ROOT/.claude/hooks/protect-verifiers.sh" ask "$ROOT"
expect "一覧ファイル自身の編集は ask" Edit "$ROOT/scripts/check/verifier-paths.txt" ask "$ROOT"
expect "ルート package.json(閾値の定義元)の編集は ask" Edit "$ROOT/package.json" ask "$ROOT"
expect "apps 配下の package.json（lint / test の定義）の編集は ask" Edit "$ROOT/apps/client/package.json" ask "$ROOT"
expect "apps 配下の tsconfig.json（strict 等）の編集は ask" Edit "$ROOT/apps/api-service/tsconfig.json" ask "$ROOT"
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
expect "NotebookEdit も検証器なら ask" NotebookEdit "$ROOT/scripts/check/x.ipynb" ask "$ROOT" notebook_path
expect "REVIEW.md（レビュー収束の採否基準）の編集は ask" Edit "$ROOT/REVIEW.md" ask "$ROOT"
expect "depcruise の解決設定の編集は ask" Edit "$ROOT/tsconfig.depcruise.json" ask "$ROOT"

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
