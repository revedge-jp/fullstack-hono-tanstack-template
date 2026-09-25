#!/bin/bash
# api-service のアプリケーションコードで process.env を直接読んでいないか(config.ts だけが読む)。
# arch-guards の guard_features_no_process_env は features/ しか見ないので、integrations / routes /
# middlewares / shared はここが拾う。check-all(pre-push)と architecture-check(CI)の両方から呼ぶ。
# 違反は stderr に出す(両スクリプトとも失敗時に stderr の末尾を表示し、stdout は拾わないことがある)
set -uo pipefail

ROOT_DIR="$(cd -- "$(dirname "$0")/../.." >/dev/null 2>&1 ; pwd -P)"
cd "$ROOT_DIR"

grep -rn "process\.env\." apps/api-service/src/ --include="*.ts" --exclude="*.test.ts" --exclude-dir="__tests__" --exclude="config.ts" >&2
case $? in
  1) exit 0 ;;
  0) echo "違反: api-service で process.env を直接参照しています(src/config.ts 経由にしてください)" >&2; exit 1 ;;
  *) exit 1 ;;
esac
