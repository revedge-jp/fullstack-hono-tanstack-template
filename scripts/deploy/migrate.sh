#!/usr/bin/env bash
# デプロイ（deploy.yml / preview.yml / 手動の初回デプロイ）のマイグレーション。DATABASE_URL に lock_timeout を付けて
# drizzle-kit migrate を実行する。ALTER TABLE 等がロックを待つ間、同じテーブルへの後続のクエリはすべてその後ろに並ぶ。
# 時間のかかるクエリの後ろで待つと、本番がジョブのタイムアウトまで止まる。5 秒で諦めてマイグレーションを失敗させ
# （Worker はデプロイされず旧版のまま）、空いている時間に再実行する（docs/deploy/operations.md の「DB マイグレーション規律」）
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL が必要です}"
LOCK_TIMEOUT="${MIGRATION_LOCK_TIMEOUT:-5s}"
case "$DATABASE_URL" in
  *\?*) separator="&" ;;
  *) separator="?" ;;
esac
cd "$(dirname "$0")/../../packages/database"

# lock_timeout は接続時のパラメータ（options）で渡す。DB の前段のプロキシがこれを拒むと、マイグレーションが毎回
# 失敗してデプロイが止まるので、先に接続を試し、拒まれたら lock_timeout 無しで続ける（警告を出す）
url_with_timeout="${DATABASE_URL}${separator}options=-c%20lock_timeout%3D${LOCK_TIMEOUT}"
if PROBE_URL="$url_with_timeout" bun -e '
  import postgres from "postgres";
  const sql = postgres(process.env.PROBE_URL, { max: 1, connect_timeout: 15 });
  try { await sql`select 1`; } finally { await sql.end({ timeout: 5 }); }
' >/dev/null 2>&1; then
  migrate_url="$url_with_timeout"
else
  echo "::warning::lock_timeout を付けた接続に失敗したので、lock_timeout 無しでマイグレーションします（DB のプロキシが options を受け付けない可能性）"
  migrate_url="$DATABASE_URL"
fi

# drizzle-kit migrate は失敗の理由を表示しない（終了コードだけ）ので、ここで考えられる理由を出す
if ! DATABASE_URL="$migrate_url" bunx drizzle-kit migrate; then
  echo "::error::マイグレーションが失敗しました（drizzle-kit は理由を表示しない）。ロックを ${LOCK_TIMEOUT} で取れなかった可能性があります。DB のログで lock timeout を確かめ、そうなら空いている時間に Deploy を rerun してください（docs/deploy/operations.md）。SQL の誤りなら直して出し直す"
  exit 1
fi
