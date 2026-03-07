# run-ci-checks: ローカルでの CI チェック実行

CI パイプラインと同じ品質チェックをローカルで実行します。

**重要: このコマンド実行中は、すべての応答を日本語で行ってください。**

## 実行内容

1. 依存関係のインストール確認
2. Lint/TypeCheck/Unit Test の実行
3. アーキテクチャ & FSD チェック（knip 除く）
4. ビルドの実行

## 実行スクリプト

```bash
set -euo pipefail

echo "🔍 CI Quality Checks を開始します..."

# 1. 依存関係の確認
echo ""
echo "📦 依存関係を確認中..."
bun install --frozen-lockfile

# 2. Lint/TypeCheck/Unit Test
echo ""
echo "✅ Lint/TypeCheck/Unit Test を実行中..."
CI=true bunx turbo run lint typecheck test:unit --concurrency=4 --cache-dir=.turbo

# 3. アーキテクチャ & FSD チェック（knip除く）
echo ""
echo "🏗️ アーキテクチャ & FSD チェックを実行中..."
SKIP_KNIP=1 bash scripts/check/architecture-check.sh

# 4. ビルド
echo ""
echo "🔨 ビルドを実行中..."
bunx turbo run build --concurrency=4 --cache-dir=.turbo

echo ""
echo "✅ すべてのCIチェックが完了しました！"
```

## 個別実行

各チェックを個別に実行する場合:

| チェック項目 | コマンド | 説明 |
|-------------|---------|------|
| Lint | `bun run lint` | Biome による静的解析 |
| 型チェック | `bun run typecheck` | TypeScript の型検証 |
| ユニットテスト | `bun run test:unit` | DB 不要のユニットテスト |
| 結合テスト | `bun run test:integration` | DB 必要の結合テスト |
| アーキテクチャ | `SKIP_KNIP=1 bash scripts/check/architecture-check.sh` | FSD、依存関係チェック |
| ビルド | `bun run build` | 本番ビルドの検証 |

## 注意事項

- 結合テストを実行する場合は、事前に Docker が起動していることを確認してください
- `bun run db:up:test` でテスト用の PostgreSQL コンテナが起動します

---

実行: チャット入力で `/run-ci-checks` を選択してください。
