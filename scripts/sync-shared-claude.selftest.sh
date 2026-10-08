#!/usr/bin/env bash
# sync-shared-claude.sh の自己テスト。偽のリポジトリと偽の gh を一時ディレクトリに作る。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHECK="$ROOT/scripts/check/check-shared-claude.sh"
SYNC="$ROOT/scripts/sync-shared-claude.sh"
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

REF=0123456789abcdef0123456789abcdef01234567

# 偽の正本（shared/ の中身に当たる）
SRC="$WORK/src"
mkdir -p "$SRC/.claude/hooks"
printf 'echo a\n' > "$SRC/.claude/hooks/a.sh"
printf 'rule b\n' > "$SRC/.claude/b.md"

# 偽の gh
BIN="$WORK/bin"
mkdir -p "$BIN"
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1" = "api" ]; then
  echo "$2" >> "$FAKE_GH_LOG"
  path="${2#repos/*/contents/shared/}"
  path="${path%%\?ref=*}"
  if [ -f "$FAKE_GH_SRC/$path" ]; then base64 < "$FAKE_GH_SRC/$path"; exit 0; fi
  echo "404 Not Found" >&2
  exit 1
fi
exit 1
GH
chmod +x "$BIN/gh"
export FAKE_GH_SRC="$SRC"

# lock だけを持つ偽リポジトリを作る。引数は file= に書く path
make_repo() {
  local dir="$1"; shift
  mkdir -p "$dir/scripts/lib" "$dir/.claude"
  git -C "$dir" init -q
  cp "$SYNC" "$dir/scripts/sync-shared-claude.sh"
  cp "$ROOT/scripts/lib/shared-claude-lock.sh" "$dir/scripts/lib/shared-claude-lock.sh"
  {
    echo "# lock"
    echo "repo=x/y"
    echo "ref=$REF"
    for f in "$@"; do echo "file=$f"; done
  } > "$dir/.claude/shared.lock"
}

# 偽の gh が呼ばれた api の一覧は <dir>/gh.log に残る（lock の検証で止まったなら空のまま）
run_sync() {
  : > "$1/gh.log"
  FAKE_GH_LOG="$1/gh.log" PATH="$BIN:$PATH" bash "$1/scripts/sync-shared-claude.sh" >"$1/out.log" 2>"$1/err.log"
}

ok() { echo "✅ $1"; }
ng() { echo "❌ $1"; FAIL=1; }

# 正常
d="$WORK/ok"; make_repo "$d" .claude/hooks/a.sh .claude/b.md
if run_sync "$d" \
  && [ "$(cat "$d/.claude/hooks/a.sh")" = "echo a" ] && [ "$(cat "$d/.claude/b.md")" = "rule b" ] \
  && [ -x "$d/.claude/hooks/a.sh" ] \
  && grep -qx "$(git -C "$d" hash-object .claude/hooks/a.sh) .claude/hooks/a.sh" "$d/.claude/shared.manifest" \
  && grep -qx "$(git -C "$d" hash-object .claude/b.md) .claude/b.md" "$d/.claude/shared.manifest" \
  && grep -qx "# source=x/y@$REF" "$d/.claude/shared.manifest" \
  && SHARED_CLAUDE_ROOT="$d" bash "$CHECK" >/dev/null 2>&1; then
  ok "正常に取り込め、check も通る"
else
  ng "正常に取り込めない"
fi

# 2 ファイル目の取得失敗では何も書き換えない
d="$WORK/partial"; make_repo "$d" .claude/hooks/a.sh .claude/missing.md
mkdir -p "$d/.claude/hooks"
printf 'old\n' > "$d/.claude/hooks/a.sh"
if ! run_sync "$d" && [ "$(cat "$d/.claude/hooks/a.sh")" = "old" ] && [ ! -e "$d/.claude/shared.manifest" ]; then
  ok "取得失敗なら exit 1 で何も書き換えない"
else
  ng "取得失敗でも書き換わった、または成功した"
fi

# 不正な file
# 取得の失敗でも exit 1 になるので、ケースごとに期待する拒否の文言まで見る（別の判定で弾かれても通らないように）
for case_line in ".claude/../x|使えません" "/etc/x|始められません" "docs/x|始まる必要があります" ".claude/shared.manifest|共有の対象にできません"; do
  bad="${case_line%%|*}"; reason="${case_line#*|}"
  d="$WORK/bad-$(printf '%s' "$bad" | tr '/.' '__')"; make_repo "$d" "$bad"
  # 止まったこと（gh を一度も呼んでいない）と、その理由の両方を見る
  if ! run_sync "$d" && [ ! -s "$d/gh.log" ] && grep -qF "$reason" "$d/err.log"; then
    ok "file=$bad は拒否"
  else
    ng "file=$bad がパスの検証で拒否されなかった"
  fi
done

# lock から外したファイルは消さず警告する
d="$WORK/drop"; make_repo "$d" .claude/hooks/a.sh .claude/b.md
run_sync "$d"
make_repo "$d" .claude/hooks/a.sh
if run_sync "$d" && grep -q "⚠️ .claude/b.md" "$d/err.log" && [ -f "$d/.claude/b.md" ]; then
  ok "lock から外すと警告し、ファイルは残す"
else
  ng "lock から外したときの挙動が違う"
fi

[ "$FAIL" = "0" ] || { echo "FAIL"; exit 1; }
