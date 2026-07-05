#!/usr/bin/env bash
#
# git worktree 管理スクリプト
#
# 使い方:
#   ./scripts/worktree.sh add <branch>    # worktree を追加
#   ./scripts/worktree.sh remove <branch> # worktree を削除
#   ./scripts/worktree.sh list            # worktree 一覧
#   ./scripts/worktree.sh setup <branch>  # 既存 worktree のセットアップ（依存インストール等）
#
# worktree は ../<project-name>-<branch> に作成されます。
# 例: feat/new-feature ブランチ → ../<project-name>-feat-new-feature
#

set -euo pipefail

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# スクリプトのディレクトリからプロジェクトルートを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
WORKTREES_BASE="$(dirname "$PROJECT_ROOT")"

# ブランチ名をディレクトリ名に変換（/ → -）
branch_to_dir() {
  echo "$1" | tr '/' '-'
}

# ヘルプ表示
show_help() {
  cat << EOF
${BLUE}git worktree 管理スクリプト${NC}

${YELLOW}使い方:${NC}
  $0 add <branch> [--no-setup]   worktree を追加（デフォルトでセットアップ実行）
  $0 remove <branch>             worktree を削除
  $0 list                        worktree 一覧を表示
  $0 setup [branch]              worktree のセットアップ（依存インストール等）
  $0 help                        このヘルプを表示

${YELLOW}例:${NC}
  $0 add feat/new-feature        # ブランチ作成 + worktree追加 + セットアップ
  $0 add origin/main --no-setup  # 既存リモートブランチのチェックアウトのみ
  $0 remove feat/new-feature     # worktree 削除
  $0 setup                       # 現在の worktree をセットアップ
  $0 setup feat/new-feature      # 指定 worktree をセットアップ

${YELLOW}worktree の場所:${NC}
  ${WORKTREES_BASE}/${PROJECT_NAME}-<branch>

${YELLOW}注意:${NC}
  - .env ファイルは新しい worktree に自動コピーされます
    - ルート/.env
    - apps/client/.env
    - apps/api-service/.env
  - セットアップ時に bun install と db:generate が実行されます
  - ポート設定は各 .env に自動反映されます（db:up で起動）

${YELLOW}ポート割り当て例:${NC}
  スロット0 (main):  Client=3000, API=8080, DB=5432, TestDB=5433
  スロット1 (dev-1): Client=3001, API=8082, DB=5434, TestDB=5435
  スロット2 (dev-2): Client=3002, API=8084, DB=5436, TestDB=5437
EOF
}

# worktree 一覧表示
list_worktrees() {
  echo -e "${BLUE}=== git worktree 一覧 ===${NC}"
  git -C "$PROJECT_ROOT" worktree list
}

# スロット番号からポートを計算
# スロット0 (main): Client=3000, API=8080, DB=5432, TestDB=5433
# スロット1 (dev-1): Client=3001, API=8082, DB=5434, TestDB=5435
# スロット2 (dev-2): Client=3002, API=8084, DB=5436, TestDB=5437
calculate_ports() {
  local slot="$1"
  CLIENT_PORT=$((3000 + slot))
  API_PORT=$((8080 + slot * 2))
  DATABASE_PORT=$((5432 + slot * 2))
  TEST_DATABASE_PORT=$((5433 + slot * 2))
}

# ブランチ名からスロット番号を抽出（dev-1 → 1, dev-2 → 2, etc.）
extract_slot_number() {
  local branch="$1"
  if [[ "$branch" =~ ^dev-([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "0"
  fi
}

# worktree のセットアップ（依存インストール等）
setup_worktree() {
  local worktree_path="$1"
  local branch="${2:-}"
  
  echo -e "${BLUE}=== worktree セットアップ: $worktree_path ===${NC}"
  
  if [[ ! -d "$worktree_path" ]]; then
    echo -e "${RED}エラー: worktree が存在しません: $worktree_path${NC}"
    exit 1
  fi
  
  cd "$worktree_path"
  
  # スロット番号を抽出してポートを計算
  if [[ -z "$branch" ]]; then
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  fi
  local slot=$(extract_slot_number "$branch")
  calculate_ports "$slot"
  
  # .env ファイルのコピー（ルート）
  if [[ ! -f ".env" && -f "$PROJECT_ROOT/.env" ]]; then
    echo -e "${YELLOW}→ ルート .env ファイルをコピー${NC}"
    cp "$PROJECT_ROOT/.env" ".env"
  fi
  
  # 各アプリの .env ファイルをコピー
  copy_app_env() {
    local app_path="$1"
    local app_name="$2"
    if [[ ! -f "$app_path/.env" && -f "$PROJECT_ROOT/$app_path/.env" ]]; then
      echo -e "${YELLOW}→ $app_name/.env をコピー${NC}"
      cp "$PROJECT_ROOT/$app_path/.env" "$app_path/.env"
    fi
  }
  copy_app_env "apps/client" "client"
  copy_app_env "apps/api-service" "api-service"
  
  # ポート設定を .env に追加/更新
  if [[ -f ".env" ]]; then
    echo -e "${YELLOW}→ ポート設定を更新${NC}"
    echo -e "  Client=$CLIENT_PORT, API=$API_PORT"
    echo -e "  DB=$DATABASE_PORT, TestDB=$TEST_DATABASE_PORT"
    
    # 既存のポート設定を削除
    sed -i '' '/^CLIENT_PORT=/d' .env 2>/dev/null || true
    sed -i '' '/^API_PORT=/d' .env 2>/dev/null || true
    sed -i '' '/^API_BASE_URL=/d' .env 2>/dev/null || true
    sed -i '' '/^SERVER_PUBLIC_URL=/d' .env 2>/dev/null || true
    sed -i '' '/^# Worktree ポート設定/d' .env 2>/dev/null || true
    # DB関連の設定を削除
    sed -i '' '/^DATABASE_PORT=/d' .env 2>/dev/null || true
    sed -i '' '/^TEST_DATABASE_PORT=/d' .env 2>/dev/null || true
    sed -i '' '/^DATABASE_URL=/d' .env 2>/dev/null || true
    sed -i '' '/^TEST_DATABASE_URL=/d' .env 2>/dev/null || true
    sed -i '' '/^POSTGRES_CONTAINER_NAME=/d' .env 2>/dev/null || true
    sed -i '' '/^POSTGRES_TEST_CONTAINER_NAME=/d' .env 2>/dev/null || true
    sed -i '' '/^POSTGRES_VOLUME_NAME=/d' .env 2>/dev/null || true
    sed -i '' '/^POSTGRES_TEST_VOLUME_NAME=/d' .env 2>/dev/null || true
    # 末尾の空行を削除
    sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' .env 2>/dev/null || true
    
    # スロット番号に基づくサフィックス（0以外の場合のみ）
    local suffix=""
    if [[ "$slot" -ne 0 ]]; then
      suffix="_slot${slot}"
    fi
    
    # 新しいポート設定を追加
    echo "" >> .env
    echo "# Worktree ポート設定 (スロット: $slot)" >> .env
    echo "CLIENT_PORT=$CLIENT_PORT" >> .env
    echo "API_PORT=$API_PORT" >> .env
    echo "API_BASE_URL=\"http://localhost:$API_PORT\"" >> .env
    echo "SERVER_PUBLIC_URL=\"http://localhost:$API_PORT\"" >> .env
    echo "" >> .env
    echo "# Worktree DB設定 (スロット: $slot)" >> .env
    echo "DATABASE_PORT=$DATABASE_PORT" >> .env
    echo "TEST_DATABASE_PORT=$TEST_DATABASE_PORT" >> .env
    echo "DATABASE_URL=\"postgresql://postgres:postgres@localhost:$DATABASE_PORT/app_db?schema=public\"" >> .env
    echo "TEST_DATABASE_URL=\"postgresql://postgres:postgres@localhost:$TEST_DATABASE_PORT/app_db?schema=public\"" >> .env
    echo "POSTGRES_CONTAINER_NAME=\"app_postgres${suffix}\"" >> .env
    echo "POSTGRES_TEST_CONTAINER_NAME=\"app_postgres_test${suffix}\"" >> .env
    echo "POSTGRES_VOLUME_NAME=\"app-postgres-data${suffix}\"" >> .env
    echo -e "${GREEN}  ルート .env のポート設定を更新しました${NC}"
  fi
  
  # apps/client/.env のポート設定を更新
  if [[ -f "apps/client/.env" ]]; then
    echo -e "${YELLOW}→ apps/client/.env のポート設定を更新${NC}"
    sed -i '' '/^API_BASE_URL=/d' apps/client/.env 2>/dev/null || true
    echo "API_BASE_URL=\"http://localhost:$API_PORT\"" >> apps/client/.env
  fi
  
  # apps/api-service/.env のポート設定を更新
  if [[ -f "apps/api-service/.env" ]]; then
    echo -e "${YELLOW}→ apps/api-service/.env のポート設定を更新${NC}"
    sed -i '' '/^DATABASE_URL=/d' apps/api-service/.env 2>/dev/null || true
    sed -i '' '/^API_PORT=/d' apps/api-service/.env 2>/dev/null || true
    echo "DATABASE_URL=\"postgresql://postgres:postgres@localhost:$DATABASE_PORT/app_db?schema=public\"" >> apps/api-service/.env
    echo "API_PORT=$API_PORT" >> apps/api-service/.env
  fi
  
  # 依存関係のインストール
  echo -e "${YELLOW}→ bun install 実行中...${NC}"
  bun install
  
  echo -e "${GREEN}=== セットアップ完了 ===${NC}"
  echo -e "${BLUE}worktree ディレクトリ: $worktree_path${NC}"
  echo ""
  echo -e "${YELLOW}次のステップ:${NC}"
  echo "  cd $worktree_path"
  echo "  bun run dev"
}

# worktree 追加
add_worktree() {
  local branch="$1"
  local no_setup="${2:-false}"
  local dir_name="${PROJECT_NAME}-$(branch_to_dir "$branch")"
  local worktree_path="${WORKTREES_BASE}/${dir_name}"
  
  echo -e "${BLUE}=== worktree 追加: $branch ===${NC}"
  echo -e "  パス: $worktree_path"
  
  # 既に存在するかチェック
  if [[ -d "$worktree_path" ]]; then
    echo -e "${RED}エラー: ディレクトリが既に存在します: $worktree_path${NC}"
    exit 1
  fi
  
  # ブランチの存在確認
  cd "$PROJECT_ROOT"
  
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    # ローカルブランチが存在
    echo -e "${YELLOW}→ 既存ローカルブランチを使用${NC}"
    git worktree add "$worktree_path" "$branch"
  elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    # リモートブランチが存在（ローカルにない）
    echo -e "${YELLOW}→ リモートブランチをチェックアウト${NC}"
    git worktree add "$worktree_path" -b "$branch" "origin/$branch"
  else
    # 新規ブランチ作成
    echo -e "${YELLOW}→ 新規ブランチを作成${NC}"
    git worktree add -b "$branch" "$worktree_path"
  fi
  
  echo -e "${GREEN}✓ worktree 作成完了${NC}"
  
  # セットアップ実行
  if [[ "$no_setup" != "true" ]]; then
    setup_worktree "$worktree_path" "$branch"
  else
    echo -e "${YELLOW}セットアップをスキップしました。手動で実行する場合:${NC}"
    echo "  $0 setup $branch"
  fi
}

# worktree 削除
remove_worktree() {
  local branch="$1"
  local dir_name="${PROJECT_NAME}-$(branch_to_dir "$branch")"
  local worktree_path="${WORKTREES_BASE}/${dir_name}"
  
  echo -e "${BLUE}=== worktree 削除: $branch ===${NC}"
  echo -e "  パス: $worktree_path"
  
  if [[ ! -d "$worktree_path" ]]; then
    echo -e "${RED}エラー: worktree が存在しません: $worktree_path${NC}"
    exit 1
  fi
  
  # 確認プロンプト
  read -p "本当に削除しますか？ (y/N): " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "キャンセルしました"
    exit 0
  fi
  
  cd "$PROJECT_ROOT"
  
  # worktree 削除
  git worktree remove "$worktree_path" --force
  
  echo -e "${GREEN}✓ worktree 削除完了${NC}"
  
  # ローカルブランチも削除するか確認
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    read -p "ローカルブランチ '$branch' も削除しますか？ (y/N): " confirm_branch
    if [[ "$confirm_branch" == "y" || "$confirm_branch" == "Y" ]]; then
      git branch -D "$branch"
      echo -e "${GREEN}✓ ブランチ削除完了${NC}"
    fi
  fi
}

# メイン処理
main() {
  if [[ $# -lt 1 ]]; then
    show_help
    exit 1
  fi
  
  local command="$1"
  shift
  
  case "$command" in
    add)
      if [[ $# -lt 1 ]]; then
        echo -e "${RED}エラー: ブランチ名を指定してください${NC}"
        exit 1
      fi
      local branch="$1"
      local no_setup="false"
      if [[ "${2:-}" == "--no-setup" ]]; then
        no_setup="true"
      fi
      add_worktree "$branch" "$no_setup"
      ;;
    remove|rm)
      if [[ $# -lt 1 ]]; then
        echo -e "${RED}エラー: ブランチ名を指定してください${NC}"
        exit 1
      fi
      remove_worktree "$1"
      ;;
    list|ls)
      list_worktrees
      ;;
    setup)
      if [[ $# -ge 1 ]]; then
        local dir_name="${PROJECT_NAME}-$(branch_to_dir "$1")"
        setup_worktree "${WORKTREES_BASE}/${dir_name}"
      else
        # 引数なしの場合は現在のディレクトリ
        setup_worktree "$(pwd)"
      fi
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      echo -e "${RED}エラー: 不明なコマンド: $command${NC}"
      show_help
      exit 1
      ;;
  esac
}

main "$@"

