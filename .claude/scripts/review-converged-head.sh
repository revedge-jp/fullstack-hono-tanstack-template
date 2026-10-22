#!/usr/bin/env bash
# 収束を宣言したコミット（PR 本文の「レビュー収束: … @ <SHA>」）より後に、レビューを通っていない変更が入っていないかを見る。
# 利用側の Review converged のワークフローが、base 側の版を呼ぶ。本文の行だけを見ていると、収束を書いたあとの push がレビューされないままマージされるため。
#   使い方: .claude/scripts/review-converged-head.sh <収束を宣言した SHA> <PR の head> <base の先端>
#   exit 0 = 宣言より後は、base を取り込んだ自動マージだけ / 1 = レビューを通っていない変更がある（理由を stdout に出す）/ 2 = 判定できない
#   使い方: .claude/scripts/review-converged-head.sh --declared-from-body < PR 本文
#   本文の最後の「レビュー収束: … CONFIRMED 0」の行から、末尾の「 @ <SHA>」を取り出して小文字で出す（行は本文の末尾に書く決まりなので、
#   書式の例や書き直す前の古い行が上に残っていても最後の行を正とする）。exit 0 = 取り出せた / 3 = 行が無い / 4 = 行に SHA が無い
# 宣言より後に許すのは、base の取り込みを git が自動で解いたマージだけ。手で衝突を解いたマージと、自動の結果に手を加えたマージは
# 内容が変わりうるので許さない（どちらもマージの tree が `git merge-tree` の結果と一致しない）。
set -uo pipefail

if [ "${1:-}" = "--declared-from-body" ]; then
  line=$(tr -d '\r' | { grep -E '^レビュー収束: .*CONFIRMED 0' || true; } | tail -n 1)
  [ -n "$line" ] || exit 3
  sha=$(sed -nE 's/.* @ ([0-9a-fA-F]{7,40})[[:space:]]*$/\1/p' <<<"$line")
  [ -n "$sha" ] || exit 4
  tr 'A-F' 'a-f' <<<"$sha"
  exit 0
fi

[ "$#" -eq 3 ] || { echo "使い方: $0 <収束を宣言した SHA> <PR の head> <base の先端>"; exit 2; }
declared_input=$1
head=$(git rev-parse -q --verify "$2^{commit}") || { echo "PR の head（$2）を解決できません"; exit 2; }
base=$(git rev-parse -q --verify "$3^{commit}") || { echo "base の先端（$3）を解決できません"; exit 2; }

if ! declared=$(git rev-parse -q --verify "$declared_input^{commit}"); then
  echo "収束を宣言した SHA（$declared_input）がこのリポジトリに見つかりません（打ち間違い・曖昧な短縮形・force-push で消えたコミット）"
  exit 1
fi
if ! git merge-base --is-ancestor "$declared" "$head"; then
  echo "収束を宣言したコミット（$declared_input）が PR の head の祖先ではありません（rebase・force-push で履歴が変わった）"
  exit 1
fi

# 宣言より後で、base にも無いコミット = この PR で宣言のあとに足されたもの（取り込んだ base のコミットは除く）
if ! after=$(git rev-list "$head" "^$declared" "^$base"); then
  echo "宣言より後のコミットを列挙できません"
  exit 2
fi
[ -z "$after" ] && exit 0

# 判定できないコミットがあっても最後まで見る（見つけた違反を、判定できなかったことで隠さない）
violations=0
undetermined=0
while IFS= read -r commit; do
  short=$(git rev-parse --short "$commit")
  read -r -a parents <<<"$(git rev-list --no-walk --parents "$commit" | cut -d' ' -f2-)"
  if [ "${#parents[@]}" -eq 1 ]; then
    echo "$short: 宣言より後のコミット（$(git log -1 --format=%s "$commit")）"
    violations=1
    continue
  fi
  if [ "${#parents[@]}" -ne 2 ]; then
    echo "$short: 親が ${#parents[@]} つのマージ（自動で解いたか確かめられない）"
    violations=1
    continue
  fi
  merged=$(git merge-tree --write-tree "${parents[0]}" "${parents[1]}" 2>/dev/null)
  merge_rc=$?
  if [ "$merge_rc" -eq 1 ]; then
    echo "$short: 衝突を手で解いたマージ"
    violations=1
  elif [ "$merge_rc" -ne 0 ]; then
    echo "$short: マージを再現できません（git merge-tree の終了コード $merge_rc）"
    undetermined=1
  elif [ "$(head -n 1 <<<"$merged")" != "$(git rev-parse "$commit^{tree}")" ]; then
    echo "$short: 自動マージの結果に手を加えたマージ"
    violations=1
  fi
done <<<"$after"
[ "$violations" -eq 1 ] && exit 1
[ "$undetermined" -eq 1 ] && exit 2
exit 0
