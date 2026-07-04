#!/bin/bash
# .ts / .tsx ファイルが編集されたら oxlint + biome で自動修正する

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

case "$FILE_PATH" in
  *.ts|*.tsx)
    if ! (cd "$CLAUDE_PROJECT_DIR" && ./node_modules/.bin/oxlint --fix "$FILE_PATH"); then
      echo "oxlint の自動修正に失敗しました: $FILE_PATH" >&2
    fi
    if ! (cd "$CLAUDE_PROJECT_DIR" && ./node_modules/.bin/biome check --write "$FILE_PATH"); then
      echo "biome の自動修正に失敗しました: $FILE_PATH" >&2
    fi
    ;;
esac

exit 0
