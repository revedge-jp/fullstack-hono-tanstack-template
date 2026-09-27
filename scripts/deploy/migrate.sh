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
# 失敗してデプロイが止まるので、先に接続を試し、拒まれたら lock_timeout 無しで続ける（警告に理由を出す）。
# 試すのは drizzle-kit と同じドライバ（drizzle-kit は pg があれば pg、無ければ postgres.js を使う）。ドライバが違うと
# URL の解釈が違い（postgres.js は未知のクエリパラメータもサーバーへ送る）、試す方だけが失敗して lock_timeout が外れる
url_with_timeout="${DATABASE_URL}${separator}options=-c%20lock_timeout%3D${LOCK_TIMEOUT}"
if probe_error=$(PROBE_URL="$url_with_timeout" bun -e '
  import { createRequire } from "node:module";
  const load = createRequire(require.resolve("drizzle-kit"));
  let pg;
  try { pg = load("pg"); } catch {}
  if (pg) {
    const client = new pg.Client({ connectionString: process.env.PROBE_URL, connectionTimeoutMillis: 15000 });
    try { await client.connect(); await client.query("select 1"); } finally { await client.end().catch(() => {}); }
  } else {
    // Bun の require は postgres の exports の "bun" 条件（ESM）を選び、関数は default にある
    const loaded = load("postgres");
    const postgres = loaded.default ?? loaded;
    const sql = postgres(process.env.PROBE_URL, { max: 1, connect_timeout: 15 });
    try { await sql`select 1`; } finally { await sql.end({ timeout: 5 }); }
  }
' 2>&1 >/dev/null); then
  migrate_url="$url_with_timeout"
  failure_hint="ロックを ${LOCK_TIMEOUT} で取れなかった可能性があります。DB のログで lock timeout を確かめ、そうなら空いている時間に Deploy を rerun してください（docs/deploy/operations.md）。SQL の誤りなら直して出し直す"
else
  probe_reason=$(printf '%s\n' "$probe_error" | grep -m1 -E '^(error|[A-Za-z]*Error):' | cut -c1-200 || true)
  echo "::warning::lock_timeout を付けた接続に失敗したので、lock_timeout 無しでマイグレーションします（理由: ${probe_reason:-不明}）"
  migrate_url="$DATABASE_URL"
  failure_hint="lock_timeout を付けた接続にも失敗しています（理由: ${probe_reason:-不明}）。接続先・認証・ネットワークを確かめてください"
fi

# drizzle-kit migrate は失敗の理由を表示しない（終了コードだけ）ので、ここで考えられる理由を出す
if ! DATABASE_URL="$migrate_url" bunx drizzle-kit migrate; then
  echo "::error::マイグレーションが失敗しました（drizzle-kit は理由を表示しない）。${failure_hint}"
  exit 1
fi
