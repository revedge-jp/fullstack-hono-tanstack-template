#!/bin/bash
# packages/database/src/schema/*.ts が編集されたら実装を止めて migrate を促す

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

if echo "$FILE_PATH" | grep -Eq '(^|/)packages/database/src/schema/.+\.ts$'; then
    # 注意: 全角括弧など多バイト文字の直前で変数展開する場合は必ず ${VAR} と波括弧で囲むこと。
    # 裸の $VAR だと bash が変数名の終端を誤認識し、変数の値が欠落することがある
    # （実測: ロケール依存でこの直後の全角閉じ括弧と衝突し中身が消えた）。
    echo "Drizzle スキーマ（${FILE_PATH}）が変更されました。実装をいったん止めます。'bun run db:generate' でマイグレーションファイルを生成し、'bun run db:migrate' を実行しますか？" >&2
    exit 2
fi

exit 0
