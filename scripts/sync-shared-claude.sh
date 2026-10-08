#!/usr/bin/env bash
# revedge-jp/claude-plugins の shared/ から、.claude/shared.lock に載るファイルを取り込む。
# 正本の shared/<path> が、このリポジトリの <path> になる。全ファイルの取得に成功してから書き換える。
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/shared-claude-lock.sh
source scripts/lib/shared-claude-lock.sh

LOCK=.claude/shared.lock
MANIFEST=.claude/shared.manifest

fail() { echo "❌ $1" >&2; exit 1; }

[ -f "$LOCK" ] || fail "$LOCK がありません"

read_shared_lock "$LOCK" >&2 || exit 1
repo="$SHARED_REPO"; ref="$SHARED_REF"; files=("${SHARED_FILES[@]}")

command -v gh >/dev/null 2>&1 || fail "gh コマンドがありません。GitHub CLI を入れてください"
gh auth status >/dev/null 2>&1 || fail "gh が認証されていません。gh auth login を実行してください"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

i=0
for f in "${files[@]}"; do
  i=$((i + 1))
  gh api "repos/$repo/contents/shared/$f?ref=$ref" -q .content | base64 --decode > "$TMP/$i" \
    || fail "$f の取得に失敗しました（何も書き換えていません）"
  [ -s "$TMP/$i" ] || fail "$f の内容が空です（何も書き換えていません）"
done

i=0
for f in "${files[@]}"; do
  i=$((i + 1))
  mkdir -p "$(dirname "$f")"
  cp "$TMP/$i" "$f"
  case "$f" in *.sh) chmod +x "$f" ;; esac
done

if [ -f "$MANIFEST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    old_path="${line#* }"
    found=0
    for f in "${files[@]}"; do [ "$f" = "$old_path" ] && found=1; done
    [ "$found" = "1" ] || echo "⚠️ $old_path は lock から外れました。共有をやめるなら手で消し、残すならこのリポジトリのファイルとして扱います" >&2
  done < "$MANIFEST"
fi

{
  echo "# scripts/sync-shared-claude.sh が生成する。手で直さない"
  echo "# source=$repo@$ref"
  for f in "${files[@]}"; do echo "$f"; done | LC_ALL=C sort | while IFS= read -r f; do
    echo "$(git hash-object "$f") $f"
  done
} > "$MANIFEST"

echo "✅ ${#files[@]} files を $repo@$ref から取り込みました"
