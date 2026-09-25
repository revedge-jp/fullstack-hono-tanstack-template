#!/bin/bash
# api-service のアプリケーションコードで process.env を直接読んでいないか(config.ts だけが読む)。
# arch-guards の guard_features_no_process_env は features/ しか見ないので、integrations / routes /
# middlewares / shared はここが拾う。check-all(pre-push)と architecture-check(CI)の両方から呼ぶ
set -uo pipefail

ROOT_DIR="$(cd -- "$(dirname "$0")/../.." >/dev/null 2>&1 ; pwd -P)"
cd "$ROOT_DIR"

grep -rn "process\.env\." apps/api-service/src/ --include="*.ts" --exclude="*.test.ts" --exclude-dir="__tests__" --exclude="config.ts"
case $? in
  1) exit 0 ;;
  0) echo "違反: api-service で process.env を直接参照しています(src/config.ts 経由にしてください)"; exit 1 ;;
  *) exit 1 ;;
esac
