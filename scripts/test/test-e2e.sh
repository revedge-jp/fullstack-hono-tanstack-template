#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --prod-shape: dev サーバーではなくビルド成果物（1 Worker に SSR + API 同居）を
# workerd で起動して E2E を流す。詳細は apps/client/playwright.config.ts を参照。
PROD_SHAPE=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --prod-shape) PROD_SHAPE=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

# テスト DB の場所は .env の TEST_DATABASE_URL を一次情報にする。
# - 共有コンテナ方式の worktree（.claude/hooks/worktree-create.sh が作る。.env に WORKTREE_SHARED_DB=1）
#   では、main の postgres-test コンテナ内の wt_<name> DB を指す。この worktree で
#   `docker compose up postgres-test` を実行すると compose プロジェクトが別になり、main の
#   コンテナとポートを奪い合って失敗するため、main の compose プロジェクトとして起動する。
# - それ以外（main、旧スロット方式の worktree、CI）は従来どおり自分の compose で postgres-test を
#   起動し、TEST_DATABASE_URL 未設定なら TEST_DATABASE_PORT（既定 5433）から組み立てる。
env_value() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$ROOT_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  value="${value//\"/}"
  echo "${value// /}"
}
SHARED_DB="$(env_value WORKTREE_SHARED_DB)"
TEST_DATABASE_URL_FROM_ENV="$(env_value TEST_DATABASE_URL)"
TEST_DATABASE_PORT_FROM_ENV="$(env_value TEST_DATABASE_PORT)"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-${TEST_DATABASE_URL_FROM_ENV:-postgresql://postgres:postgres@localhost:${TEST_DATABASE_PORT_FROM_ENV:-5433}/app_db}}"

WRANGLER_JSONC="$ROOT_DIR/apps/client/wrangler.jsonc"
DEV_VARS="$ROOT_DIR/apps/client/.dev.vars"
# init-template.sh の置換対象にならないよう、プレースホルダーは動的に組み立てる（同スクリプトと同じ理由）
PLACEHOLDER='{{'APP_NAME'}}'
WRANGLER_BACKUP=""
WRANGLER_REPLACED=""
DEV_VARS_REPLACED=0

cleanup() {
  # プレースホルダーを一時置換した場合は退避したファイルで戻す（逆置換だと元からあった同じ文字列まで
  # 戻してしまい、git checkout はファイルの他の未コミット編集まで消してしまう）
  # 実行中に wrangler.jsonc が編集されていたら（置換直後の内容と違えば）上書きせず、退避先を知らせる
  if [ -n "$WRANGLER_BACKUP" ]; then
    if cmp -s "$WRANGLER_JSONC" "$WRANGLER_REPLACED"; then
      cp "$WRANGLER_BACKUP" "$WRANGLER_JSONC"
      rm -f "$WRANGLER_BACKUP"
    else
      echo "⚠️  テスト中に wrangler.jsonc が変更されたため元に戻していません。置換前の内容: $WRANGLER_BACKUP" >&2
    fi
    rm -f "$WRANGLER_REPLACED"
  fi
  # .dev.vars を dev 用の symlink（bun run dev が張るのと同じ）に復元する
  if [ "$DEV_VARS_REPLACED" = "1" ]; then
    rm -f "$DEV_VARS"
    ln -sf ../../.env "$DEV_VARS"
  fi
}
trap cleanup EXIT

echo "==> Starting test database..."
if [ "$SHARED_DB" = "1" ]; then
  MAIN_ROOT="$(cd "$ROOT_DIR" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
  docker compose --project-directory "$MAIN_ROOT" up -d --no-recreate postgres-test --wait
else
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres-test --wait
fi

echo "==> Running drizzle migrations..."
cd "$ROOT_DIR/packages/database"
DATABASE_URL="$TEST_DATABASE_URL" bun run db:migrate

# テンプレート原本（APP_NAME プレースホルダーのまま）では @cloudflare/vite-plugin が
# wrangler.jsonc の name 検証で落ち、vite dev / vite build のどちらも起動できないため、
# 一時的に置換してテスト後に戻す（CI の置換ステップと同じ扱い）。
if grep -qF "$PLACEHOLDER" "$WRANGLER_JSONC"; then
  echo "==> Temporarily replacing the APP_NAME placeholder in wrangler.jsonc..."
  # 退避が完了してから WRANGLER_BACKUP に入れる（途中で止まっても後始末が空のファイルで上書きしない）
  backup="$(mktemp)"
  cp "$WRANGLER_JSONC" "$backup"
  WRANGLER_REPLACED="$(mktemp)"
  WRANGLER_BACKUP="$backup"
  PLACEHOLDER="$PLACEHOLDER" perl -pi -e 's/\Q$ENV{PLACEHOLDER}\E/template-app/g' "$WRANGLER_JSONC"
  cp "$WRANGLER_JSONC" "$WRANGLER_REPLACED"
fi

if [ "$PROD_SHAPE" = "1" ]; then
  export E2E_PROD_SHAPE=1
  E2E_PORT=3100
  echo "==> Mode: prod-shape (built worker on workerd, port $E2E_PORT)"
else
  E2E_PORT=3200
  echo "==> Mode: dev (vite dev server, port $E2E_PORT)"
fi

# E2E 専用ポートに前回実行の孤児プロセスが残っていると reuseExistingServer: false でも
# 起動に失敗する（bunx 経由の子プロセスが Playwright の kill を生き残ることがある）。
# ポート番号だけでは持ち主を断定できない（別の worktree で実行中の E2E や、無関係のプロセスが
# 同じポートを使っていることがある）ので、作業ディレクトリが同じチェックアウトにあるものだけ止める。
# パスの前方一致では判定しない — worktree は main の .claude/worktrees/ の下にあるので、main から実行すると
# worktree の E2E サーバーまで一致する。作業ディレクトリの git のトップレベルを実パスで比べる。
# git は GIT_* を外して呼ぶ（git フックから起動されたとき GIT_DIR を引き継ぎ、どのディレクトリでも
# 同じリポジトリを答えてしまうため）
toplevel_of() {
  (
    for var in $(compgen -e | grep '^GIT_' || true); do unset "$var"; done
    top="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || exit 0
    cd "$top" && pwd -P
  )
}
ORPHAN_PIDS=$(lsof -ti "tcp:$E2E_PORT" -sTCP:LISTEN 2>/dev/null || true)
ROOT_DIR_TOPLEVEL="$(toplevel_of "$ROOT_DIR")"
ROOT_DIR_PHYSICAL="$(cd "$ROOT_DIR" && pwd -P)"
FOREIGN_PIDS=""
for pid in $ORPHAN_PIDS; do
  pid_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)"
  same_checkout=0
  if [ -z "$pid_cwd" ]; then
    :
  elif [ -n "$ROOT_DIR_TOPLEVEL" ]; then
    [ "$(toplevel_of "$pid_cwd")" = "$ROOT_DIR_TOPLEVEL" ] && same_checkout=1
  else
    # git の無いチェックアウト（ZIP で取得した直後）には worktree も無いので、パスの前方一致で足りる
    case "$pid_cwd" in "$ROOT_DIR_PHYSICAL" | "$ROOT_DIR_PHYSICAL"/*) same_checkout=1 ;; esac
  fi
  if [ "$same_checkout" = 1 ]; then
    echo "==> Killing orphaned E2E server on port $E2E_PORT (pid: $pid)..."
    kill "$pid" 2>/dev/null || true
  else
    FOREIGN_PIDS="$FOREIGN_PIDS $pid"
  fi
done
if [ -n "$FOREIGN_PIDS" ]; then
  echo "❌ port $E2E_PORT is used by a process outside this checkout (pid:$FOREIGN_PIDS). Stop it and re-run." >&2
  exit 1
fi
if [ -n "$ORPHAN_PIDS" ]; then
  sleep 1
fi

# Worker（と E2E ヘルパー）が読む .dev.vars を test DB 向けに一時差し替える。
# CI の "Create .dev.vars for E2E" ステップと同じ内容（ローカルでの自己完結用）。
# dev モードもこれを使うことで、E2E が開発用 DB（.env の DATABASE_URL）に触れないようにする。
echo "==> Writing temporary .dev.vars pointing at the test database..."
rm -f "$DEV_VARS"
cat > "$DEV_VARS" <<VARS
NODE_ENV=development
DATABASE_URL=$TEST_DATABASE_URL
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-dummy-secret-for-e2e}
BETTER_AUTH_URL=http://localhost:$E2E_PORT
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-dummy-client-id}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-dummy-client-secret}
VARS
DEV_VARS_REPLACED=1

echo "==> Running Playwright E2E tests..."
cd "$ROOT_DIR/apps/client"
npx playwright test ${ARGS+"${ARGS[@]}"}
