#!/usr/bin/env bash
#
# Claude Code の WorktreeCreate フック。
#
# 重要: これは「後処理フック」ではなく「置換フック」。設定されている場合 Claude Code は自前の
# `git worktree add` を実行せず、このスクリプトが worktree を作って *絶対パスだけ* を stdout に
# 出すことを期待する。進捗ログはすべて stderr に出すこと。
#
# stdin: {"session_id":..,"cwd":..,"hook_event_name":"WorktreeCreate","name":"<slug>"}
# stdout: worktree の絶対パス（1行、これ以外を出さない）
#
# 手動で再実行（冪等）: echo '{"name":"<slug>"}' | .claude/hooks/worktree-create.sh
#
# 注意: 変数の直後に全角文字を続けるときは必ず ${VAR} と書く。macOS 標準の bash 3.2 は UTF-8
# ロケールで、波括弧なしの変数参照の直後にある全角文字の先頭バイトを変数名の一部と解釈し、
# unbound variable で落ちる
# （置換フックなので worktree が1つも作れなくなる。派生プロダクトで実際に踏んだ）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./worktree-lib.sh
source "$SCRIPT_DIR/worktree-lib.sh"

require_tools jq lsof git bun

# 実 stdout を fd 3 に退避し、以降 stdout に書かれたものは stderr へ流す
# （bun install などが標準出力に喋ってもパス出力を汚さないため）。
exec 3>&1
exec 1>&2

payload="$(cat)"
name="$(printf '%s' "$payload" | jq -r '.name // empty')"
[ -n "$name" ] || die "WorktreeCreate ペイロードに name がありません"

WT_PATH="$MAIN_ROOT/.claude/worktrees/$name"
BRANCH="claude/$name"
# 再実行（agent-worktree-setup.sh）では .env にある名前を使い続ける。命名規則を変える前に作った
# worktree で名前を計算し直すと、空の DB を新しく作って .env をそちらに向けてしまう
DB_NAME="$(db_name_for_worktree "$WT_PATH" "$name")"
ENV_DB_NAME="$(db_name_from_env "$WT_PATH")"
# .env がこの worktree の名前から求めうる DB を指していない（別の worktree の .env をコピーした・改名した）。
# 黙って空の DB に切り替えたり、他の worktree の DB にマイグレーションを当てたりしないよう止める
if [ -n "$ENV_DB_NAME" ] && [ "$ENV_DB_NAME" != "$DB_NAME" ]; then
  # 案内する名前が他の worktree の DB なら（以前の規則の worktree と重なった）、作成時と同じくハッシュ付きを出す
  suggested="$DB_NAME"
  if worktree_using_db "$suggested" "$WT_PATH" >/dev/null; then
    suggested="$(hashed_db_name_for "$name")"
  fi
  die ".env の DATABASE_URL の DB（${ENV_DB_NAME}）は、この worktree の名前（${name}）から求める DB ではありません
  （別の worktree の .env をコピーした・git worktree move で改名した等。改名は非対応です）。
  $WT_PATH/.env の DATABASE_URL / TEST_DATABASE_URL の DB 名を $suggested に直してから再実行してください（データは移りません）"
fi
if other="$(worktree_using_db "$DB_NAME" "$WT_PATH")"; then
  if [ "$DB_NAME" = "$ENV_DB_NAME" ]; then
    # .env が既に他の worktree と同じ DB を指している（変更前の規則で作った worktree 同士、または手で
    # 向けた）。名前を変えると空の DB に切り替わるのでそのまま使い、知らせるだけにする
    log "警告: DB $DB_NAME は $other と共有しています。片方を削除してももう片方の DB は消しません"
  else
    DB_NAME="$(hashed_db_name_for "$name")"
    log "DB 名が $other と重なるため $DB_NAME を使います"
    # DB を飛ばすだけだと .env の DATABASE_URL がその DB を指したまま共有されるので、何も作らずに止める
    if other="$(worktree_using_db "$DB_NAME" "$WT_PATH")"; then
      die "DB $DB_NAME も $other が使っています。別の worktree 名で作り直してください"
    fi
  fi
fi
PROJECT_NAME="$(basename "$MAIN_ROOT")"

echo "=== worktree セットアップ: $name ===" >&2

# --- 1. worktree 作成 -------------------------------------------------------
if [ -d "$WT_PATH" ]; then
  log "既存の worktree を再利用: $WT_PATH"
else
  if git -C "$MAIN_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    log "既存ブランチ $BRANCH で worktree を作成"
    git -C "$MAIN_ROOT" worktree add "$WT_PATH" "$BRANCH" >&2
  else
    # 分岐元は origin/main。main チェックアウトの HEAD は別ブランチに居ることがあり、ローカル main も
    # 遅れうる（.claude/rules/general.md「git diff main はローカル main の鮮度に依存する」）。
    # fetch は best-effort。
    BASE="${CLAUDE_WORKTREE_BASE:-}"
    if [ -z "$BASE" ]; then
      # オフライン時に TCP タイムアウトまで EnterWorktree 全体が待たないよう低速判定を短くする
      git -C "$MAIN_ROOT" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 fetch -q origin main >&2 2>&1 \
        || log "origin/main の fetch に失敗（手元の origin/main を使います）"
      if git -C "$MAIN_ROOT" show-ref --verify --quiet refs/remotes/origin/main; then
        BASE="origin/main"
      else
        BASE="HEAD"
      fi
    fi
    log "新規ブランチ $BRANCH で worktree を作成（分岐元: ${BASE}）"
    # --no-track: 分岐元が origin/main（リモート追跡ブランチ）だと既定で upstream が origin/main に
    # なり、引数なしの git push が push.default 次第で main を狙う・@{upstream} 基準の判定が main
    # 基準になる。upstream は初回の git push -u で自分のリモートブランチに張る。
    git -C "$MAIN_ROOT" worktree add --no-track -b "$BRANCH" "$WT_PATH" "$BASE" >&2
  fi
fi

# --- 2. ポート割り当て ------------------------------------------------------
allocate_ports "$name"

# --- 3. 共有 Postgres と専用データベース ------------------------------------
# Docker が動いていなくても worktree 作成自体は成功させる。置換フックなので、ここで失敗すると
# 「DB のない worktree」ではなく「worktree が作られない」になる。DB は後から作り直せる。
SKIP_DB=0
if is_ephemeral_worktree_name "$name"; then
  log "使い捨て worktree（${name}）と判定: DB 作成・マイグレーションを省略します"
  log "  DB も必要な場合は CLAUDE_WORKTREE_FULL_SETUP=1 を設定してください"
  SKIP_DB=1
elif ! docker info >/dev/null 2>&1; then
  log "Docker が起動していません。DB 作成・マイグレーションをスキップします"
  log "  Docker 起動後に復旧する場合（worktree のルートで）: bash scripts/agent-worktree-setup.sh"
  SKIP_DB=1
fi

if [ "$SKIP_DB" -eq 0 ]; then
  if ensure_shared_postgres && create_worktree_databases "$DB_NAME"; then
    :
  else
    log "データベースを用意できなかったため、マイグレーションをスキップします"
    SKIP_DB=1
  fi
fi

DB_PORT="$(main_env_value DATABASE_PORT 5432)"
TEST_DB_PORT="$(main_env_value TEST_DATABASE_PORT 5433)"
DB_URL="postgresql://postgres:postgres@localhost:${DB_PORT}/${DB_NAME}"
TEST_DB_URL="postgresql://postgres:postgres@localhost:${TEST_DB_PORT}/${DB_NAME}"

# --- 4. .env 生成 -----------------------------------------------------------
ENV_FILE="$WT_PATH/.env"
ENV_MISSING=0
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$MAIN_ROOT/.env" ]; then
    cp "$MAIN_ROOT/.env" "$ENV_FILE"
    log ".env を main からコピー"
  elif [ -f "$MAIN_ROOT/.env.example" ]; then
    cp "$MAIN_ROOT/.env.example" "$ENV_FILE"
    log "警告: main に .env が無いため .env.example から作成します（認証系の値はダミーのままです）"
  else
    ENV_MISSING=1
    log "警告: .env を生成できませんでした（$MAIN_ROOT に .env も .env.example もありません）"
  fi
fi

set_env_var() {
  local key="$1" value="$2"
  [ -f "$ENV_FILE" ] || return 0
  grep -vE "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}

if [ "$ENV_MISSING" -eq 0 ]; then
  log ".env にこの worktree 固有の値を反映"
  set_env_var CLIENT_PORT "$WT_CLIENT_PORT"
  set_env_var API_PORT "$WT_API_PORT"
  # ブラウザは client のポートの /api/auth を開く（API は client の Worker が同じポートで返す）。
  # API_PORT にすると OAuth のコールバック URL が client と食い違う
  set_env_var BETTER_AUTH_URL "http://localhost:$WT_CLIENT_PORT"
  set_env_var BETTER_AUTH_TRUSTED_ORIGINS "http://localhost:$WT_CLIENT_PORT"
  set_env_var CORS_ORIGIN "http://localhost:$WT_CLIENT_PORT"
  set_env_var DATABASE_PORT "$DB_PORT"
  set_env_var TEST_DATABASE_PORT "$TEST_DB_PORT"
  set_env_var DATABASE_URL "$DB_URL"
  set_env_var TEST_DATABASE_URL "$TEST_DB_URL"
  # コンテナ名・volume 名は main のものを**継承しない**。compose の named volume はプロジェクトを
  # 跨いだグローバルな名前解決なので、main の名前のままだとこの worktree で誤って db:reset
  # （compose down -v）した際に main の volume を巻き込む。一意なダミーにしておけば db:down / db:reset は
  # 何もせず、db:up はポート衝突で失敗する。
  set_env_var POSTGRES_CONTAINER_NAME "${PROJECT_NAME}_postgres_wt_${name}"
  set_env_var POSTGRES_TEST_CONTAINER_NAME "${PROJECT_NAME}_postgres_test_wt_${name}"
  set_env_var POSTGRES_VOLUME_NAME "${PROJECT_NAME}-postgres-data-wt-${name}"
  set_env_var PGADMIN_CONTAINER_NAME "${PROJECT_NAME}_pgadmin_wt_${name}"
  set_env_var PGADMIN_VOLUME_NAME "${PROJECT_NAME}-pgadmin-data-wt-${name}"
  # scripts/test/test-e2e.sh と scripts/lib/db-setup.sh が「共有コンテナ方式」を見分ける印。
  # DB が実際に用意できたかは別キー WORKTREE_DB_READY で示す（下）。Docker 停止中や使い捨て判定で
  # DB を飛ばしたときにこの印だけ立つと、/start-dev の検証が「完全セットアップ」と読み違える。
  set_env_var WORKTREE_SHARED_DB 1
  grep -vE '^WORKTREE_DB_READY=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"

  if ! grep -q '^# NOTE: DB は main の共有コンテナ' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<NOTE

# NOTE: DB は main の共有コンテナ（$(main_env_value POSTGRES_CONTAINER_NAME app_postgres) / $(main_env_value POSTGRES_TEST_CONTAINER_NAME app_postgres_test)）内の
# データベース $DB_NAME を使っています。この worktree から db:up / db:down を実行しないこと
# （compose のプロジェクトが別になり、ポートを奪い合って失敗します）。
NOTE
  fi
fi

# --- 5. 依存インストールとマイグレーション ----------------------------------
cd "$WT_PATH"

# ここから先の失敗で worktree 作成ごと失敗させない。置換フックなので異常終了すると Claude Code 側は
# 「作成失敗」と扱うが、git worktree add・ポート割当・DB 作成は既に済んでおり、WorktreeRemove も
# 呼ばれないため残留物だけが残る。警告に留め、パスは必ず返して後から復旧できるようにする。
SETUP_FAILED=0
MIGRATE_FAILED=0

log "bun install 実行中..."
LEFTHOOK=0 bun install --silent >&2 || SETUP_FAILED=1

if [ "$SETUP_FAILED" -eq 0 ] && [ "$SKIP_DB" -eq 0 ] && [ "$ENV_MISSING" -eq 0 ]; then
  log "マイグレーション適用中 (dev)..."
  bun run db:migrate >&2 || MIGRATE_FAILED=1
  log "マイグレーション適用中 (test)..."
  (cd packages/database && DATABASE_URL="$TEST_DB_URL" bunx drizzle-kit migrate >&2) || MIGRATE_FAILED=1
fi

if [ "$SKIP_DB" -eq 0 ] && [ "$MIGRATE_FAILED" -eq 0 ] && [ "$SETUP_FAILED" -eq 0 ] && [ "$ENV_MISSING" -eq 0 ]; then
  set_env_var WORKTREE_DB_READY 1
fi

if [ "$SKIP_DB" -eq 0 ]; then
  echo "=== 完了: client=${WT_CLIENT_PORT} api=${WT_API_PORT} db=${DB_NAME} ===" >&2
else
  echo "=== 完了: client=${WT_CLIENT_PORT} api=${WT_API_PORT} db=（未作成） ===" >&2
fi
if [ "$ENV_MISSING" -eq 1 ]; then
  echo "=== 注意: .env が無いため、この worktree はまだ起動できません ===" >&2
  echo "      cd $MAIN_ROOT && cp .env.example .env  # 値を埋めてからフックを再実行（冪等）" >&2
fi
if [ "$MIGRATE_FAILED" -eq 1 ]; then
  echo "=== 注意: マイグレーション未適用です。worktree のルートで再実行してください（冪等） ===" >&2
  echo "      bash scripts/agent-worktree-setup.sh" >&2
fi
if [ "$SETUP_FAILED" -eq 1 ]; then
  echo "=== 注意: bun install に失敗しました。worktree 内で復旧してください ===" >&2
  echo "      bun install && bun run db:migrate" >&2
fi

printf '%s\n' "$WT_PATH" >&3
