#!/bin/bash
# .ts / .tsx ファイルが編集されたら oxlint + oxfmt で自動修正し、client の画面文言をチェックする

INPUT=$(cat)

# シンボリックリンク経由のパス（macOS の /tmp 等）でも git rev-parse --show-toplevel と比べられるよう、
# 実体のパスに解決する
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json, os
try:
    d = json.load(sys.stdin)
    path = d.get('tool_input', {}).get('file_path', '')
    print(os.path.realpath(path) if path else '')
except Exception:
    print('')
" 2>/dev/null || echo "")

case "$FILE_PATH" in
  *.ts|*.tsx)
    # 整形はファイルがあるチェックアウト（worktree ならその worktree）の設定と node_modules で行う。
    # main（CLAUDE_PROJECT_DIR）から worktree のファイルに oxlint をかけると、worktree の .oxlintrc.json を
    # 入れ子の設定として読んで設定エラーになり、自動修正が一度も効かない
    FMT_ROOT=$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null)
    if [ -z "$FMT_ROOT" ] || [ ! -x "$FMT_ROOT/node_modules/.bin/oxlint" ]; then
      FMT_ROOT="$CLAUDE_PROJECT_DIR"
    fi
    if ! (cd "$FMT_ROOT" && ./node_modules/.bin/oxlint --fix "$FILE_PATH"); then
      echo "oxlint の自動修正に失敗しました: $FILE_PATH" >&2
    fi
    if ! (cd "$FMT_ROOT" && ./node_modules/.bin/oxfmt --no-error-on-unmatched-pattern "$FILE_PATH"); then
      echo "oxfmt の整形に失敗しました: $FILE_PATH" >&2
    fi
    # client の画面文言に AI が書く文章に出やすい語が無いかを、整形の後に続けてチェックする（別のフックに
    # すると並列に走り、整形中のファイルを読みうる）。worktree のファイルは CLAUDE_PROJECT_DIR の外にあるので、
    # ルートはファイル自身の場所から求める。違反のときだけ exit 2 で返し、チェックの失敗（例外）では止めない
    ROOT=$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null)
    case "${FILE_PATH#"$ROOT"/}" in
      apps/client/*)
        OUT=$(cd "$ROOT" && node scripts/check/ui-copy.mjs "$FILE_PATH" 2>&1)
        if printf '%s' "$OUT" | grep -q '^違反 \['; then
          echo "AI が書く文章に出やすい表現が見つかりました。何がどうなるかを書く言葉に直してください（.claude/rules/client.md の「UI 文言の書き方」）。" >&2
          printf '%s\n' "$OUT" >&2
          exit 2
        fi
        ;;
    esac
    ;;
esac

exit 0
