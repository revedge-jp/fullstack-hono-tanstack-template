#!/usr/bin/env bash
#
# Claude Code の EnterWorktree で作成された `.claude/worktrees/<name>` 専用のセットアップスクリプト。
# メインチェックアウトや他の worktree と衝突しないポート・DB コンテナを自動割り当てし、
# 依存関係インストールからマイグレーションまで行う。
#
# 使い方（.claude/worktrees/<name> 直下で実行すること）:
#   bash scripts/agent-worktree-setup.sh          # 初回セットアップ（.env が既にあればポート再割り当てはスキップ）
#   bash scripts/agent-worktree-setup.sh --force  # ポート割り当てをやり直す
#
# scripts/worktree.sh（ユーザー自身が使う ../<project>-<branch> 形式の手動 worktree 用）とは
# 別物。こちらは .claude/worktrees/<name> 配下でのみ動作する。

set -euo pipefail

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

WORKTREE_ROOT="$(pwd)"

if [[ ! "$WORKTREE_ROOT" =~ /\.claude/worktrees/[^/]+$ ]]; then
  echo "❌ エラー: .claude/worktrees/<name> 直下（worktree のルート）で実行してください（現在地: $WORKTREE_ROOT）"
  exit 1
fi

# worktree のパス構造から直接メインリポジトリのルートを導く
# （git plumbing より単純で、上の正規表現チェックで構造を保証済み）
MAIN_ROOT="${WORKTREE_ROOT%/.claude/worktrees/*}"
PROJECT_NAME="$(basename "$MAIN_ROOT")"

if [[ ! -f "$MAIN_ROOT/docker-compose.yml" ]]; then
  echo "❌ エラー: メインリポジトリルートの特定に失敗しました（$MAIN_ROOT）"
  exit 1
fi

DEFAULT_DB_PORT=5432

# worktree が使う4種のポート（.env のキー名）。空きスロット探索でこの4つすべてを検査し、
# 他環境の .env からもこの4つすべてを used_ports に集める。DATABASE_PORT だけを見る実装だと、
# TEST_DATABASE_PORT がスロット探索でも used_ports 収集でも無視され、メインが既定以外の
# DB ポートを使っていると別環境のテスト DB ポートと衝突する。
PORT_KEYS=(CLIENT_PORT API_PORT DATABASE_PORT TEST_DATABASE_PORT)

# 指定 .env から指定キーのポート値を返す（未設定なら空文字）
port_of() {
  local envfile="$1"
  local key="$2"
  local port
  port="$(grep -E "^${key}=" "$envfile" 2>/dev/null | tail -1 | cut -d= -f2)"
  port="${port%$'\r'}"
  port="${port//\"/}"
  port="${port// /}"
  echo "$port"
}

# 指定 .env の CLIENT/API/DB/TEST_DB ポートをすべて used_ports へ追加する（未設定キーは無視）。
# `[[ ... ]] && used_ports+=()` を関数末尾に置くと、条件が偽（未設定キー）のとき関数全体が
# 非ゼロ終了し `set -e` で無言終了するため、明示的な if で書く。
collect_ports_from_env() {
  local envfile="$1"
  local key
  local port
  for key in "${PORT_KEYS[@]}"; do
    port="$(port_of "$envfile" "$key")"
    if [[ -n "$port" ]]; then
      used_ports+=("$port")
    fi
  done
}

# メインの DB ポートは未設定でも既定 5432 を使うため、シードとして入れておく
used_ports=("$DEFAULT_DB_PORT")

if [[ -f "$MAIN_ROOT/.env" ]]; then
  collect_ports_from_env "$MAIN_ROOT/.env"
fi

# 他の Claude worktree（.claude/worktrees/*/.env）
for envfile in "$MAIN_ROOT"/.claude/worktrees/*/.env; do
  [[ -f "$envfile" ]] || continue
  [[ "$(dirname "$envfile")" == "$WORKTREE_ROOT" ]] && continue
  collect_ports_from_env "$envfile"
done

# scripts/worktree.sh 由来の手動 worktree（../<project>-<branch>/.env）
for envfile in "$(dirname "$MAIN_ROOT")/${PROJECT_NAME}"-*/.env; do
  [[ -f "$envfile" ]] || continue
  collect_ports_from_env "$envfile"
done

is_port_free() {
  local port="$1"
  local used
  for used in "${used_ports[@]}"; do
    [[ "$used" == "$port" ]] && return 1
  done
  # 孤児コンテナや無関係なプロセスが実際にリッスンしていないかも確認
  if lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

# スロットが導出する4ポート（Client/API/DB/TestDB）すべてが空いているスロットを探す。
# DB ポートだけを見て TestDB を検査しないと、TestDB が既存環境のポートと衝突しても
# 素通りしてしまう（DB は偶数・TestDB は奇数のため、DB だけ見ても TestDB の衝突は
# 捕まえられない）。
SLOT=1
while true; do
  CANDIDATE_CLIENT_PORT=$((3000 + SLOT))
  CANDIDATE_API_PORT=$((8080 + SLOT * 2))
  CANDIDATE_DB_PORT=$((5432 + SLOT * 2))
  CANDIDATE_TEST_DB_PORT=$((5433 + SLOT * 2))
  if is_port_free "$CANDIDATE_CLIENT_PORT" &&
    is_port_free "$CANDIDATE_API_PORT" &&
    is_port_free "$CANDIDATE_DB_PORT" &&
    is_port_free "$CANDIDATE_TEST_DB_PORT"; then
    break
  fi
  SLOT=$((SLOT + 1))
done

CLIENT_PORT=$CANDIDATE_CLIENT_PORT
API_PORT=$CANDIDATE_API_PORT
DATABASE_PORT=$CANDIDATE_DB_PORT
TEST_DATABASE_PORT=$CANDIDATE_TEST_DB_PORT

if [[ -f ".env" && "$FORCE" != "true" ]]; then
  echo "ℹ️  .env が既に存在するためポート割り当てはスキップします（やり直す場合は --force）"
else
  if [[ -f "$MAIN_ROOT/.env" ]]; then
    cp "$MAIN_ROOT/.env" .env
  elif [[ -f "$MAIN_ROOT/.env.example" ]]; then
    echo "⚠️  メインの .env が見つからないため .env.example から作成します（認証系の値はダミーのままです）"
    cp "$MAIN_ROOT/.env.example" .env
  else
    echo "❌ エラー: $MAIN_ROOT に .env も .env.example もありません"
    exit 1
  fi

  # ポート/DB 関連の既存設定を削除し、このスロット専用の値に置き換える
  # PGADMIN_* はこの worktree では pgadmin コンテナ自体を起動しないが、`docker compose` の
  # named volume はプロジェクト(ディレクトリ)を跨いだグローバルな名前解決になるため、
  # 上書きせず既定値（app-pgadmin-data 等）のままだと、worktree 内で誤って
  # `docker compose down -v`（= bun run db:down）を実行した際にメイン環境の pgadmin
  # データボリュームを巻き込んで削除しうる。使わない前提でも一意な値にしておく防御策。
  for key in CLIENT_PORT API_PORT API_BASE_URL DATABASE_PORT TEST_DATABASE_PORT \
    DATABASE_URL TEST_DATABASE_URL POSTGRES_CONTAINER_NAME POSTGRES_TEST_CONTAINER_NAME \
    POSTGRES_VOLUME_NAME PGADMIN_CONTAINER_NAME PGADMIN_VOLUME_NAME \
    BETTER_AUTH_URL BETTER_AUTH_TRUSTED_ORIGINS CORS_ORIGIN; do
    perl -ni -e "print unless /^${key}=/" .env
  done

  {
    echo ""
    echo "# --- agent-worktree-setup.sh が自動設定（スロット: ${SLOT}） ---"
    echo "CLIENT_PORT=${CLIENT_PORT}"
    echo "API_PORT=${API_PORT}"
    echo "API_BASE_URL=http://localhost:${API_PORT}"
    echo "DATABASE_PORT=${DATABASE_PORT}"
    echo "TEST_DATABASE_PORT=${TEST_DATABASE_PORT}"
    echo "DATABASE_URL=postgresql://postgres:postgres@localhost:${DATABASE_PORT}/app_db"
    echo "TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:${TEST_DATABASE_PORT}/app_db"
    echo "POSTGRES_CONTAINER_NAME=${PROJECT_NAME}_postgres_wt${SLOT}"
    echo "POSTGRES_TEST_CONTAINER_NAME=${PROJECT_NAME}_postgres_test_wt${SLOT}"
    echo "POSTGRES_VOLUME_NAME=${PROJECT_NAME}-postgres-data-wt${SLOT}"
    echo "PGADMIN_CONTAINER_NAME=${PROJECT_NAME}_pgadmin_wt${SLOT}"
    echo "PGADMIN_VOLUME_NAME=${PROJECT_NAME}-pgadmin-data-wt${SLOT}"
    echo "BETTER_AUTH_URL=http://localhost:${API_PORT}"
    echo "BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:${CLIENT_PORT}"
    echo "CORS_ORIGIN=http://localhost:${CLIENT_PORT}"
  } >>.env

  echo "✅ .env を作成しました（スロット ${SLOT}: Client=${CLIENT_PORT} API=${API_PORT} DB=${DATABASE_PORT} TestDB=${TEST_DATABASE_PORT}）"
fi

echo "📦 依存関係をインストール中..."
LEFTHOOK=0 bun install --silent

echo "🗄️  worktree 専用の DB コンテナを起動中（postgres, postgres-test。pgadmin は共有前提のため起動しません）..."
bun run db:up:all

echo "🔧 マイグレーションを適用中..."
bun run db:migrate

echo ""
echo "✅ worktree セットアップ完了"
echo "   Client : http://localhost:${CLIENT_PORT}"
echo "   API    : http://localhost:${API_PORT}"
echo "   DB     : localhost:${DATABASE_PORT}"
echo "   TestDB : localhost:${TEST_DATABASE_PORT}"
echo ""
echo "💡 次のステップ: bun run dev"
