#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/app_db}"

echo "==> Starting test database..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres-test --wait

echo "==> Running drizzle migrations..."
cd "$ROOT_DIR/packages/database"
DATABASE_URL="$TEST_DATABASE_URL" bun run db:migrate

echo "==> Running Playwright E2E tests..."
cd "$ROOT_DIR/apps/client"
npx playwright test "$@"
