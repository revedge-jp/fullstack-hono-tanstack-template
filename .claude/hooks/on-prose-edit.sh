#!/bin/bash
# 文書と client の画面文言が編集されたら、AI が書く文章に出やすい語（「効く」「正典」等）・誇張・
# 全角ダッシュをその場でチェックし、指摘を Claude に返す（exit 2。編集自体は取り消されない）。
# pre-push（check-all の Prose と arch:guards）でも同じチェックが走るが、そこまで待つと文言をまとめて
# 書いた後で直すことになるので、書いた直後に知らせる。
#
# 対象の範囲は package.json の lint:prose（文書）と scripts/check/ui-copy.mjs の ROOTS（画面文言）に揃える。
# どちらかを変えたらここも直す。

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

[ -n "$FILE_PATH" ] || exit 0
[ -f "$FILE_PATH" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE_PATH#"$ROOT"/}"

# チェック自体を実行できない（node_modules が無い等）ときは編集を止めない。pre-push で同じチェックが走る。
report() { # $1 出力, $2 規約の場所
  echo "AI が書く文章に出やすい表現が見つかりました（${REL}）。何がどうなるかを書く言葉に直してください（${2}）。" >&2
  printf '%s\n' "$1" >&2
  exit 2
}

case "$REL" in
  AGENTS.md | REVIEW.md | apps/*/AGENTS.md | .claude/rules/*.md | .claude/commands/*.md | docs/*.md)
    OUT=$(cd "$ROOT" && ./node_modules/.bin/textlint "$REL" 2>&1)
    RC=$?
    # textlint は指摘ありで 1、設定の読み込み失敗などで 2 を返す
    [ "$RC" -eq 1 ] && report "$OUT" ".claude/rules/general.md の「編集方針」"
    ;;
  apps/client/*.ts | apps/client/*.tsx)
    OUT=$(cd "$ROOT" && node scripts/check/ui-copy.mjs "$REL" 2>&1)
    # 違反なら「違反 [」で始まる行を出して 1 を返す。それ以外の失敗（例外）は止めない
    printf '%s' "$OUT" | grep -q '^違反 \[' && report "$OUT" ".claude/rules/client.md の「UI 文言の書き方」"
    ;;
esac

exit 0
