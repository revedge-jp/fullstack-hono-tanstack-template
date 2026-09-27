#!/usr/bin/env bash
# デプロイ（deploy.yml / preview.yml / 手動の初回デプロイ）のマイグレーション。DATABASE_URL に lock_timeout を付けて drizzle-kit migrate を実行する。
# ALTER TABLE 等がロックを待つ間、同じテーブルへの後続のクエリはすべてその後ろに並ぶ。長く走るクエリの後ろで待つと、
# 本番がジョブのタイムアウトまで止まる。5 秒で諦めてマイグレーションを失敗させ（Worker はデプロイされず旧版のまま）、
# 空いている時間に再実行する（docs/deploy/operations.md の「DB マイグレーション規律」）
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL が必要です}"
LOCK_TIMEOUT="${MIGRATION_LOCK_TIMEOUT:-5s}"
case "$DATABASE_URL" in
  *\?*) separator="&" ;;
  *) separator="?" ;;
esac
cd "$(dirname "$0")/../../packages/database"
DATABASE_URL="${DATABASE_URL}${separator}options=-c%20lock_timeout%3D${LOCK_TIMEOUT}" exec bunx drizzle-kit migrate
