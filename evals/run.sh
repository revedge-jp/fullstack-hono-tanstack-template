#!/usr/bin/env bash
# 評価タスクを一時 worktree で実行し、採点結果を evals/results に書く。
# 使い方: bash evals/run.sh <task> [hook|nohook]
set -euo pipefail
TASK="${1:?task name}"
CONDITION="${2:-hook}"
# 普段の開発で使うモデルに固定する。~/.claude/settings.json の model(例: sonnet)に引きずられると
# 「評価したモデル」と「実際に使うモデル」がずれ、結果が当てはまらない。Sonnet は安いので
# ハーネス自体の動作確認(smoke)に使い、ルールの効果測定は EVAL_MODEL 既定の fable で行う。
MODEL="${EVAL_MODEL:-fable}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_DIR="$ROOT/evals/tasks/$TASK"
[ -d "$TASK_DIR" ] || { echo "unknown task: $TASK" >&2; exit 2; }
STAMP=$(date +%Y%m%d-%H%M%S)
WT="$ROOT/.claude/worktrees/eval-$TASK-$STAMP"
RESULT="$ROOT/evals/results/$TASK-$CONDITION-$MODEL-$STAMP.json"

cleanup() { git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git -C "$ROOT" worktree add -q --detach "$WT" HEAD
cd "$WT"
bun install --frozen-lockfile >/dev/null
bash "$TASK_DIR/setup.sh"
git add -A && git -c user.name=eval -c user.email=eval@example.com commit -q -m "chore: eval setup" # 採点で setup 分を差分から除くため

# nohook は検証器編集の ask を外す(deny 系はそのまま)。フック側が環境変数を見る
if [ "$CONDITION" = "nohook" ]; then export CLAUDE_EVAL_DISABLE_VERIFIER_ASK=1; fi

START=$(date +%s)
set +e
# acceptEdits だけだと Bash が全部拒否され、テストもゲートも実行できないまま書くことになる。
# 検証コマンドは許可し、検証器の編集はフック(ask → ヘッドレスでは拒否)に判定させる。
# `bun -e` / `node -e` の一行スクリプトは許可しない。ただし `bun run ./x.ts` や `bun test`(テスト
# 本体は任意コード)でファイルを書く経路は残る。フックは Edit/Write しか見ないので、採点は git diff で行う。
CLAUDE_OUT="$ROOT/evals/results/.tmp-$TASK-$CONDITION-$STAMP"
mkdir -p "$CLAUDE_OUT"
claude -p "$(cat "$TASK_DIR/prompt.md")" \
  --model "$MODEL" \
  --permission-mode acceptEdits \
  --allowedTools "Bash(bun run:*)" "Bash(bun test:*)" "Bash(bunx tsc:*)" "Bash(bunx oxlint:*)" "Bash(bunx oxfmt:*)" "Bash(node scripts/check:*)" "Bash(cd:*)" "Bash(cat:*)" "Bash(ls:*)" "Bash(grep:*)" "Bash(git diff:*)" "Bash(git status:*)" \
  --output-format json \
  --max-turns 60 \
  --max-budget-usd 8 \
  --no-session-persistence \
  > "$CLAUDE_OUT/claude.json" 2> "$CLAUDE_OUT/claude.err"
CLAUDE_EXIT=$?
set -e
ELAPSED=$(( $(date +%s) - START ))

SCORE=$(bash "$TASK_DIR/score.sh" 2>"$CLAUDE_OUT/score.err" || true)
[ -n "$SCORE" ] || SCORE=$(python3 -c "import json,sys; print(json.dumps({'score_error': open(sys.argv[1]).read()[-2000:]}))" "$CLAUDE_OUT/score.err")
python3 - "$CLAUDE_OUT/claude.json" "$SCORE" "$TASK" "$CONDITION" "$STAMP" "$CLAUDE_EXIT" "$ELAPSED" "$(git -C "$ROOT" rev-parse --short HEAD)" "$MODEL" > "$RESULT" <<'PY'
import sys, json
raw, score, task, cond, stamp, cexit, elapsed, sha, model = sys.argv[1:]
try:
    c = json.load(open(raw))
except Exception:
    c = {}
out = {
    "task": task, "condition": cond, "at": stamp, "repo_sha": sha,
    "model_requested": model,
    "model_used": list((c.get("modelUsage") or {}).keys()),
    "claude": {
        "exit": int(cexit), "elapsed_s": int(elapsed),
        "num_turns": c.get("num_turns"), "total_cost_usd": c.get("total_cost_usd"),
        "is_error": c.get("is_error"), "stop_reason": c.get("stop_reason"),
        "permission_denials": c.get("permission_denials"),
    },
    "score": json.loads(score),
}
print(json.dumps(out, ensure_ascii=False, indent=2))
PY
rm -rf "$CLAUDE_OUT"
echo "result: $RESULT"
cat "$RESULT"
