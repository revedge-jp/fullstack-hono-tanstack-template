#!/usr/bin/env bash
#
# start-from-main.sh / sync-main.sh 共用の「.env プリフライト + マイグレーション」。
# 以前は両スクリプトが同じブロックを持ち、Prisma 時代の文言（"Already in sync" /
# "Can't reach database server"）を grep していたが、drizzle-kit はどちらも出さないため
# 成功しても「⚠️ 続行中」、DB 停止中でも「⚠️ 続行中」→「✅ 同期完了」と表示されていた。
# 判定は drizzle-kit の終了コード（成功 0 / 失敗 1）を一次情報にする。
#
# 使い方: source "<scripts ディレクトリ>/lib/db-setup.sh"; setup_database
# （packages/database が無い場所では何もしない）

is_hook_worktree() {
  [[ "$PWD" == */.claude/worktrees/* ]] && grep -qE '^WORKTREE_SHARED_DB=1$' .env 2>/dev/null
}

# .env が無いと `dotenv -e .env` は素通りし、drizzle-kit が「DATABASE_URL is not set」で落ちる
# だけになって原因（.env 不在）に辿り着けない。先に検出して復旧手順を出す。
preflight_env() {
  [[ -f .env ]] && return 0
  echo "❌ .env がありません"
  if [[ "$PWD" == */.claude/worktrees/* ]]; then
    echo "   💡 この worktree は WorktreeCreate フックが .env を生成するはずです。冪等に再実行してください:"
    echo "      bash scripts/agent-worktree-setup.sh"
  else
    echo "   💡 cp .env.example .env"
  fi
  exit 1
}

# 失敗時の切り分け。drizzle-kit は接続失敗の理由を出力しない（スピナーのまま exit 1）ので、
# .env の DATABASE_URL の host:port へ TCP 疎通して「DB 未起動」を切り分ける。
print_migrate_hint() {
  # フック管理の worktree で DB 未作成（Docker 停止中に作られた等）なら、必要なのは db:up ではなく
  # フックの再実行。WORKTREE_DB_READY は worktree-create.sh が DB 作成成功時だけ書く。
  if is_hook_worktree && ! grep -qE '^WORKTREE_DB_READY=1$' .env; then
    echo "   💡 この worktree の DB はまだ作られていません。フックを冪等に再実行してください:"
    echo "      bash scripts/agent-worktree-setup.sh"
    return 0
  fi
  local url host port
  url="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  url="${url%%\?*}"  # クエリ文字列（?sslmode=... 等）に @ が入っても host を誤らないよう先に落とす
  # 認証情報は最後の @ までとして落とす（パスワードに @ を含む URL でも host を誤らない）
  host="$(printf '%s' "$url" | sed -E 's#^[a-z]+://(.*@)?([^:/]+).*#\2#')"
  port="$(printf '%s' "$url" | sed -nE 's#^[a-z]+://(.*@)?[^:/]+:([0-9]+).*#\2#p')"
  if [[ -n "$host" && -n "$port" ]] && ! (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
    echo "   💡 $host:$port に接続できません。データベースが起動していない可能性があります: bun run db:up"
    if is_hook_worktree; then
      echo "      （フック管理の worktree なら main 側で bun run db:up）"
    fi
  fi
}

# 成功以外は生出力を見せて exit 1（「新しいマイグレーションが無い」も drizzle-kit は 0 で返す）。
setup_database() {
  # サブディレクトリから直接 bash で呼ばれても DB ステップが無言で飛ばないよう、ルートへ寄せる
  cd "$(git rev-parse --show-toplevel)"
  [[ -f packages/database/package.json ]] || return 0
  preflight_env
  echo "🗄️ データベースをセットアップ中..."
  echo "   🔄 データベースマイグレーションを実行中..."
  local output
  if output="$(bun run db:migrate 2>&1)"; then
    echo "   ✅ データベースは最新です"
    return 0
  fi
  echo "   ❌ マイグレーションに失敗しました"
  printf '%s\n' "$output" | sed 's/^/      /'
  print_migrate_hint
  exit 1
}
