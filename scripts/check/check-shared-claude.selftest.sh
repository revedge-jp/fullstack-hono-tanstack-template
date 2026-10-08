#!/usr/bin/env bash
# check-shared-claude.sh の自己テスト。偽のリポジトリを一時ディレクトリに作り、SHARED_CLAUDE_ROOT で向ける。
set -uo pipefail
cd "$(dirname "$0")/../.."
SCRIPT="$PWD/scripts/check/check-shared-claude.sh"
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

REF=0123456789abcdef0123456789abcdef01234567

# 一致している偽リポジトリを作る
make_repo() {
  local dir="$1"
  mkdir -p "$dir/.claude/hooks"
  git -C "$dir" init -q
  printf 'echo a\n' > "$dir/.claude/hooks/a.sh"
  printf 'echo b\n' > "$dir/.claude/hooks/b.sh"
  chmod +x "$dir/.claude/hooks/a.sh" "$dir/.claude/hooks/b.sh"
  printf '# lock\nrepo=x/y\nref=%s\nfile=.claude/hooks/a.sh\nfile=.claude/hooks/b.sh\n' "$REF" > "$dir/.claude/shared.lock"
  {
    echo "# manifest"
    echo "# source=x/y@$REF"
    echo "$(git -C "$dir" hash-object .claude/hooks/a.sh) .claude/hooks/a.sh"
    echo "$(git -C "$dir" hash-object .claude/hooks/b.sh) .claude/hooks/b.sh"
  } > "$dir/.claude/shared.manifest"
}

expect() {
  local name="$1" want="$2" dir="$3"
  SHARED_CLAUDE_ROOT="$dir" bash "$SCRIPT" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "✅ $name (exit $got)"; else echo "❌ $name: exit $want のはずが $got"; FAIL=1; fi
}

d="$WORK/nolock"; mkdir -p "$d"
expect "lock が無ければ何もしない" 0 "$d"

d="$WORK/ok"; make_repo "$d"
expect "一致している" 0 "$d"

d="$WORK/edited"; make_repo "$d"
printf 'echo changed\n' > "$d/.claude/hooks/a.sh"
expect "ファイルを書き換えた" 1 "$d"

d="$WORK/deleted"; make_repo "$d"
rm "$d/.claude/hooks/b.sh"
expect "manifest にあるファイルを消した" 1 "$d"

d="$WORK/unlisted"; make_repo "$d"
printf 'file=.claude/hooks/c.sh\n' >> "$d/.claude/shared.lock"
expect "lock に足したが manifest に無い" 1 "$d"

d="$WORK/badref"; make_repo "$d"
sed -i.bak 's/^ref=.*/ref=abc123/' "$d/.claude/shared.lock"
expect "ref が 40 桁でない" 1 "$d"

d="$WORK/nomanifest"; make_repo "$d"
rm "$d/.claude/shared.manifest"
expect "manifest が無い" 1 "$d"

d="$WORK/extramanifest"; make_repo "$d"
echo "$(git -C "$d" hash-object .claude/hooks/a.sh) .claude/hooks/c.sh" >> "$d/.claude/shared.manifest"
cp "$d/.claude/hooks/a.sh" "$d/.claude/hooks/c.sh"
expect "manifest にだけ余計な行がある" 1 "$d"

d="$WORK/nolock-manifest"; make_repo "$d"
rm "$d/.claude/shared.lock"
expect "lock が無く manifest がある" 1 "$d"

d="$WORK/tworepo"; make_repo "$d"
printf 'repo=x/z\n' >> "$d/.claude/shared.lock"
expect "lock に repo= が 2 つ" 1 "$d"

d="$WORK/tworef"; make_repo "$d"
printf 'ref=%s\n' "$REF" >> "$d/.claude/shared.lock"
expect "lock に ref= が 2 つ" 1 "$d"

d="$WORK/nofile"; make_repo "$d"
sed -i.bak '/^file=/d' "$d/.claude/shared.lock" && printf '# empty\n' > "$d/.claude/shared.manifest"
expect "lock に file= が無い" 1 "$d"

d="$WORK/badline"; make_repo "$d"
printf 'bogus line\n' >> "$d/.claude/shared.lock"
expect "lock に解釈できない行がある" 1 "$d"

d="$WORK/sourcemismatch"; make_repo "$d"
sed -i.bak 's/^# source=.*/# source=x\/y@fedcba9876543210fedcba9876543210fedcba98/' "$d/.claude/shared.manifest"
expect "manifest の # source= が lock と違う" 1 "$d"

d="$WORK/nosource"; make_repo "$d"
sed -i.bak '/^# source=/d' "$d/.claude/shared.manifest"
expect "manifest に # source= が無い" 1 "$d"

d="$WORK/noexec"; make_repo "$d"
chmod -x "$d/.claude/hooks/a.sh"
expect ".sh の実行権限を外した" 1 "$d"

d="$WORK/outsidepath"; make_repo "$d"
# manifest にも載せて整合させ、パスの規則だけで落ちるようにする
mkdir -p "$d/docs"; printf 'x\n' > "$d/docs/x"
printf 'file=docs/x\n' >> "$d/.claude/shared.lock"
echo "$(git -C "$d" hash-object docs/x) docs/x" >> "$d/.claude/shared.manifest"
expect "lock に .claude/ の外の file=" 1 "$d"

d="$WORK/locksself"; make_repo "$d"
printf 'file=.claude/shared.lock\n' >> "$d/.claude/shared.lock"
echo "$(git -C "$d" hash-object .claude/shared.lock) .claude/shared.lock" >> "$d/.claude/shared.manifest"
expect "lock に file=.claude/shared.lock" 1 "$d"

[ "$FAIL" = "0" ] || { echo "FAIL"; exit 1; }
