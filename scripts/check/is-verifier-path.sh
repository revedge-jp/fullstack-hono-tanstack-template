#!/usr/bin/env bash
# 引数(リポジトリルート相対パス)のうち verifier-paths.txt に一致するものを出力する。
# 一致が 1 つでもあれば exit 0、無ければ exit 1。フックと CI が同じ判定を共有するための 1 枚。
set -uo pipefail
LIST="$(cd "$(dirname "$0")" && pwd)/verifier-paths.txt"
found=1
for rel in "$@"; do
  while IFS= read -r pattern; do
    case "$pattern" in ""|\#*) continue ;; esac
    # shellcheck disable=SC2254 # パターンとして展開させたい
    case "$rel" in $pattern) echo "$rel"; found=0; break ;; esac
  done < "$LIST"
done
exit $found
