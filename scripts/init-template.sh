#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# テンプレート初期化スクリプト
#
# {{APP_NAME}} プレースホルダーをアプリ名に一括置換する。
# テンプレートから新しいプロジェクトを作ったら、最初に一度だけ実行する。
#
# 使い方:
#   ./scripts/init-template.sh <app-name>
#   例: ./scripts/init-template.sh my-app
#
# app-name の制約（Cloudflare Workers の name 制約に準拠）:
#   - 英小文字・数字・ハイフンのみ / 先頭末尾は英数字
#   - 54文字以内（"-staging" サフィックスを付けても Workers の上限 63 文字に収まる長さ）
# =============================================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# このスクリプト自身が git grep に引っかからないよう、プレースホルダーは動的に組み立てる
PLACEHOLDER='{{'APP_NAME'}}'

# 置換対象外: プレースホルダーの「仕組み」そのものを説明・処理しているファイル
EXCLUDES=(
  "docs/dev/troubleshooting.md"   # プレースホルダー起因のエラーの説明
  "scripts/init-template.sh"      # 自分自身
)

usage() {
  echo "使い方: $0 <app-name>"
  echo "  例: $0 my-app"
  echo "  制約: 英小文字・数字・ハイフンのみ（先頭末尾は英数字）、54文字以内"
}

if [ $# -ne 1 ]; then
  usage
  exit 1
fi

APP_NAME="$1"

if ! printf '%s' "$APP_NAME" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'; then
  echo "エラー: app-name は英小文字・数字・ハイフンのみで、先頭末尾は英数字にしてください: $APP_NAME" >&2
  usage
  exit 1
fi

if [ "${#APP_NAME}" -gt 54 ]; then
  echo "エラー: app-name は54文字以内にしてください（staging サフィックス込みで Workers の name 上限に収めるため）: ${#APP_NAME}文字" >&2
  exit 1
fi

# 対象ファイルを収集する。追跡中のファイルだけを見ると、ZIP で取得した直後や `.git` を作り直した直後
# （まだ何もコミットしていない）に 1 件も見つからず、何も置換せずに「初期化済み」で終わってしまう。
# このディレクトリ自体が git リポジトリのルートなら --untracked で未追跡（.gitignore の対象外）も含め、
# そうでなければ grep で探す。親ディレクトリの別リポジトリ（ホームを管理する dotfiles 等）の配下では、
# その .gitignore が効いて 0 件になるので git を使わない。--show-prefix は macOS の /var と /private/var の
# 違いに左右されない（--show-toplevel と $ROOT の文字列比較だと食い違う）
is_own_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ -z "$(git rev-parse --show-prefix 2>/dev/null)" ]
}
list_targets() {
  if is_own_repo; then
    # -z: 日本語や " を含むファイル名は、既定だと引用符付き（"docs/\346…"）で出て perl が開けずに置換が漏れる。
    # NUL 区切り（引用しない）で受けて改行に直す（core.quotePath=false だけでは " の引用は止まらない）
    git grep -z --untracked -l -F "$PLACEHOLDER" | tr '\0' '\n'
  else
    grep -rlF "$PLACEHOLDER" . \
      --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo \
      --exclude-dir=.output --exclude-dir=coverage | sed 's#^\./##'
  fi
}
# 一致なし（終了コード 1）と失敗（2 以上）を分ける。失敗を「0 件」として扱うと初期化済みと誤って案内する
SEARCH_ERR="$(mktemp)"
trap 'rm -f "$SEARCH_ERR"' EXIT
set +e
FOUND="$(list_targets 2>"$SEARCH_ERR")"
FOUND_RC=$?
set -e
if [ "$FOUND_RC" -gt 1 ]; then
  echo "エラー: 置換対象の検索に失敗しました（終了コード $FOUND_RC）:" >&2
  sed 's/^/  /' "$SEARCH_ERR" >&2
  exit 1
fi

# ※ mapfile は macOS 標準の bash 3.2 に無いため while-read で組む
TARGETS=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  skip=0
  for ex in "${EXCLUDES[@]}"; do
    if [ "$f" = "$ex" ]; then
      skip=1
      break
    fi
  done
  [ "$skip" = "0" ] && TARGETS+=("$f")
done <<EOF
$FOUND
EOF

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "✅ 置換対象が見つかりません。すでに初期化済みのようです。"
  exit 0
fi

echo "アプリ名 '$APP_NAME' で以下のファイルを初期化します:"
for f in "${TARGETS[@]}"; do
  count=$(grep -c "$PLACEHOLDER" "$f" || true)
  echo "  • $f (${count}箇所)"
done

for f in "${TARGETS[@]}"; do
  # perl -pi: macOS / Linux 両対応のインプレース置換（sed -i は挙動が異なるため使わない）
  APP_NAME="$APP_NAME" PLACEHOLDER="$PLACEHOLDER" perl -pi -e 's/\Q$ENV{PLACEHOLDER}\E/$ENV{APP_NAME}/g' "$f"
done

# ルート package.json の name フィールドをアプリ名に置換する。
# ※ apps/*/package.json（api-service / client）と packages/*（@repo/db 等）の name は
#    import されるワークスペース名なので置換しない。ここでは root の package.json のみを対象にし、
#    先頭の "name" フィールド（= ルートパッケージ名）1件だけを書き換える。
if [ -f package.json ]; then
  echo "  • package.json (root name)"
  APP_NAME="$APP_NAME" perl -0pi -e 's/("name":\s*)"[^"]*"/$1 . "\"" . $ENV{APP_NAME} . "\""/e' package.json
fi

# .env.example の DB コンテナ名・volume 名をアプリ名入りにする。既定の app_* のままだと、
# このテンプレートから作った別プロジェクトと Docker 上で同じ名前になり、db:up が他プロジェクトの
# DB の volume をマウントし、db:reset が消しうる（docker の named volume はプロジェクトを跨いで共有される）。
# 既に作ってある .env は書き換えない（稼働中の volume 名を変えると空の DB で起動するため）。
if [ -f .env.example ]; then
  echo "  • .env.example (DB コンテナ名・volume 名)"
  APP_NAME="$APP_NAME" perl -pi -e '
    s/^POSTGRES_CONTAINER_NAME=.*/POSTGRES_CONTAINER_NAME=$ENV{APP_NAME}_postgres/;
    s/^POSTGRES_TEST_CONTAINER_NAME=.*/POSTGRES_TEST_CONTAINER_NAME=$ENV{APP_NAME}_postgres_test/;
    s/^POSTGRES_VOLUME_NAME=.*/POSTGRES_VOLUME_NAME=$ENV{APP_NAME}-postgres-data/;
    s/^PGADMIN_CONTAINER_NAME=.*/PGADMIN_CONTAINER_NAME=$ENV{APP_NAME}_pgadmin/;
    s/^PGADMIN_VOLUME_NAME=.*/PGADMIN_VOLUME_NAME=$ENV{APP_NAME}-pgadmin-data/;
  ' .env.example
  if [ -f .env ]; then
    echo "  ⚠️  既存の .env は書き換えていません。DB の名前を揃えるなら .env.example の5行を手で反映してください"
    echo "     （稼働中の DB があるなら、先に bun run db:reset するとデータは消えます）"
  fi
fi

echo ""
echo "✅ 初期化が完了しました。"

# テンプレート名の残りを案内する（README の見出しなど、プロジェクトに合わせて書き換えるもの）。
# bun.lock のルート名はワークスペースの解決に使われないので残っていてよい（bun install では更新されない）
TEMPLATE_NAME="fullstack-hono-tanstack-template"
STALE="$(grep -rnF "$TEMPLATE_NAME" . --include='*.md' --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null || true)"
if [ -n "$STALE" ]; then
  echo ""
  echo "📝 テンプレート名（$TEMPLATE_NAME）が残っている文書です。プロジェクトに合わせて書き換えてください:"
  printf '%s\n' "$STALE" | sed 's/^/  /'
fi
echo ""
echo "次のステップ:"
if ! is_own_repo; then
  echo "  0. git init する（bun install の prepare が lefthook を入れるのに git リポジトリが要る。"
  echo "     親ディレクトリの別リポジトリの中なら、そこにコミットしないよう、このディレクトリで git init する）"
fi
echo "  1. bun install で依存を入れる"
echo "  2. 変更内容を確認してコミット: git diff && git add -A && git commit -m 'chore: initialize template as $APP_NAME'"
echo "  3. README.md のタイトル・説明を自分のプロジェクト用に書き換える"
echo "  4. .env を作成する: cp .env.example .env（README のクイックスタート参照）"
echo "  5. GitHub リポジトリの保護設定・Renovate を有効化: ./scripts/setup-github.sh"
echo "  6. CI/CD デプロイ用の GitHub Environments（Secrets / Variables）を設定する"
echo "     bash scripts/setup-deploy-env.sh staging（対話式。詳細: docs/deploy/cloudflare-workers.md）"
