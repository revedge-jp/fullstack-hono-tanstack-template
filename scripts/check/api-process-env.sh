#!/bin/bash
# api-service のアプリケーションコードで process.env を直接読んでいないか(config.ts だけが読む)。
# arch-guards の guard_features_no_process_env は features/ しか見ないので、integrations / routes /
# middlewares / shared はここが拾う。check-all(pre-push)と architecture-check(CI)の両方から呼ぶ。
# 違反は stderr に出す(両スクリプトとも失敗時に stderr の末尾を表示し、stdout は拾わないことがある)
set -uo pipefail

ROOT_DIR="$(cd -- "$(dirname "$0")/../.." >/dev/null 2>&1 ; pwd -P)"
cd "$ROOT_DIR"

# 対象が無いと grep は(macOS では)「一致なし」の 1 を返し、検査したことになってしまう
[ -d apps/api-service/src ] || { echo "apps/api-service/src が見つかりません" >&2; exit 1; }

# 除外は src/config.ts だけ(パスで一致させる)。grep の --exclude はファイル名で一致するので、
# それを使うと src/shared/**/config.ts 等のどの階層の config.ts も素通りする
# process.env.X だけでなく process.env["X"]・process["env"]・分割代入（const { env } = process も）・
# node:process / cloudflare:workers から env を取り出す import・Bun.env・import.meta.env も拾う
# （cloudflare:workers の DurableObject 等、env 以外の import は止めない）
hits=$(grep -rnE "process\.env|process\[|=[[:space:]]*process[[:space:]]*;?[[:space:]]*\$|[{,][[:space:]]*env([[:space:]]+as[[:space:]]+[A-Za-z_\$]+)?[[:space:]]*[,}][^;]*from [\"'](node:process|process|cloudflare:workers)[\"']|Bun\.env|import\.meta\.env" \
  apps/api-service/src/ --include="*.ts" --exclude="*.test.ts" --exclude-dir="__tests__")
[ $? -gt 1 ] && exit 1
hits=$(printf '%s\n' "$hits" | grep -v '^apps/api-service/src/config\.ts:' | grep -v '^$')
if [ -n "$hits" ]; then
  printf '%s\n' "$hits" >&2
  echo "違反: api-service で process.env を直接参照しています(src/config.ts 経由にしてください)" >&2
  exit 1
fi
exit 0
