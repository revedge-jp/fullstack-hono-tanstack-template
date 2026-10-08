#!/usr/bin/env bash
# .claude/shared.lock に載る共有ファイルが、取り込んだ版（.claude/shared.manifest）のままか確かめる。
# ネットワークは使わない（CI から private リポジトリを読まない）。
set -uo pipefail
LIB="$(cd "$(dirname "$0")/../lib" && pwd)/shared-claude-lock.sh"
cd "${SHARED_CLAUDE_ROOT:-$(dirname "$0")/../..}" || exit 1

LOCK=.claude/shared.lock
MANIFEST=.claude/shared.manifest
FIX="共有ファイルは revedge-jp/claude-plugins の shared/ で直し、.claude/shared.lock の ref を更新して bash scripts/sync-shared-claude.sh を流してください"

if [ ! -f "$LOCK" ]; then
  if [ -f "$MANIFEST" ]; then
    echo "❌ $LOCK が無いのに $MANIFEST があります。$FIX"
    exit 1
  fi
  exit 0
fi

FAIL=0
# shellcheck source=../lib/shared-claude-lock.sh
source "$LIB"
read_shared_lock "$LOCK" || FAIL=1
lock_files=""
for f in ${SHARED_FILES[@]+"${SHARED_FILES[@]}"}; do lock_files+="$f"$'\n'; done

if [ ! -f "$MANIFEST" ]; then
  echo "❌ $MANIFEST がありません。$FIX"
  exit 1
fi

manifest_paths=""; count=0; manifest_source=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '# source='*) manifest_source="${line#\# source=}"; continue ;;
    ''|'#'*) continue ;;
  esac
  hash="${line%% *}"
  path="${line#* }"
  manifest_paths+="$path"$'\n'
  count=$((count + 1))
  if [ ! -f "$path" ]; then
    echo "❌ $path がありません。$FIX"
    FAIL=1
    continue
  fi
  case "$path" in
    *.sh)
      if [ ! -x "$path" ]; then
        echo "❌ $path に実行権限がありません。$FIX"
        FAIL=1
      fi ;;
  esac
  if [ "$(git hash-object "$path")" != "$hash" ]; then
    echo "❌ $path が取り込んだ版と違います。$FIX"
    FAIL=1
  fi
done < "$MANIFEST"

if [ -z "$manifest_source" ]; then
  echo "❌ $MANIFEST に # source= の行がありません。$FIX"
  FAIL=1
elif [ "$manifest_source" != "$SHARED_REPO@$SHARED_REF" ]; then
  echo "❌ $LOCK（$SHARED_REPO@$SHARED_REF）と取り込んだ版（$manifest_source）が違います。bash scripts/sync-shared-claude.sh を流してください"
  FAIL=1
fi

lock_sorted=$(printf '%s' "$lock_files" | LC_ALL=C sort)
manifest_sorted=$(printf '%s' "$manifest_paths" | LC_ALL=C sort)
if [ "$lock_sorted" != "$manifest_sorted" ]; then
  echo "❌ $LOCK の file と $MANIFEST の path が一致しません。$FIX"
  diff <(printf '%s\n' "$lock_sorted") <(printf '%s\n' "$manifest_sorted") | sed -e 's/^/  ❌ /'
  FAIL=1
fi

[ "$FAIL" = "0" ] || exit 1
echo "✅ 共有の .claude ファイル: OK ($count files)"
