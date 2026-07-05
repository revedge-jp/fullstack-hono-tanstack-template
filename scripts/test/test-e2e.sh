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

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/app_db}"

WRANGLER_JSONC="$ROOT_DIR/apps/client/wrangler.jsonc"
DEV_VARS="$ROOT_DIR/apps/client/.dev.vars"
APP_NAME_REPLACED=0
DEV_VARS_REPLACED=0

cleanup() {
  # {{APP_NAME}} を一時置換した場合は逆置換で戻す
  # （git checkout はファイルの他の未コミット編集まで消してしまうため使わない）
  if [ "$APP_NAME_REPLACED" = "1" ]; then
    perl -pi -e 's/template-app/\{\{APP_NAME\}\}/g' "$WRANGLER_JSONC"
  fi
  # .dev.vars を dev 用の symlink（bun run dev が張るのと同じ）に復元する
  if [ "$DEV_VARS_REPLACED" = "1" ]; then
    rm -f "$DEV_VARS"
    ln -sf ../../.env "$DEV_VARS"
  fi
}
trap cleanup EXIT

echo "==> Starting test database..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres-test --wait

echo "==> Running drizzle migrations..."
cd "$ROOT_DIR/packages/database"
DATABASE_URL="$TEST_DATABASE_URL" bun run db:migrate

# テンプレート原本（{{APP_NAME}} プレースホルダーのまま）では @cloudflare/vite-plugin が
# wrangler.jsonc の name 検証で落ち、vite dev / vite build のどちらも起動できないため、
# 一時的に置換してテスト後に戻す（CI の置換ステップと同じ扱い）。
if grep -q '{{APP_NAME}}' "$WRANGLER_JSONC"; then
  echo "==> Temporarily replacing {{APP_NAME}} placeholder in wrangler.jsonc..."
  perl -pi -e 's/\{\{APP_NAME\}\}/template-app/g' "$WRANGLER_JSONC"
  APP_NAME_REPLACED=1
fi

if [ "$PROD_SHAPE" = "1" ]; then
  export E2E_PROD_SHAPE=1

  # Worker（と E2E ヘルパー）が読む .dev.vars を test DB 向けに一時差し替える。
  # CI の "Create .dev.vars for E2E" ステップと同じ内容（ローカルでの自己完結用）。
  echo "==> Writing temporary .dev.vars pointing at the test database..."
  rm -f "$DEV_VARS"
  cat > "$DEV_VARS" <<VARS
DATABASE_URL=$TEST_DATABASE_URL
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-dummy-secret-for-e2e}
BETTER_AUTH_URL=http://localhost:3100
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-dummy-client-id}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-dummy-client-secret}
VARS
  DEV_VARS_REPLACED=1

  echo "==> Running Playwright E2E tests (prod-shape: built worker on workerd)..."
else
  echo "==> Running Playwright E2E tests (dev servers)..."
fi

cd "$ROOT_DIR/apps/client"
npx playwright test ${ARGS+"${ARGS[@]}"}
