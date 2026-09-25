#!/bin/bash
# アーキテクチャガード。検査の本体は arch-guards-lib.sh の関数（自己テストから1つずつ呼ぶため）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=./arch-guards-lib.sh
source "$ROOT/scripts/check/arch-guards-lib.sh"

# 条件の中で呼ばない（arch-guards-lib.sh 冒頭の注意）。違反・想定外の失敗は set -e でここで止まる。
for guard in "${ARCH_GUARDS[@]}"; do
  run_guard "$guard"
done
