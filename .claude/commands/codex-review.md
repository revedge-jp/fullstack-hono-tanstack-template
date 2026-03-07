以下の手順でコードレビューを実施してください。

## ステップ1: モード判定

まず Bash で以下を実行してモードを決定してください。

```bash
MARKER=".claude/last-review-commit"
if [ -f "$MARKER" ]; then
  LAST=$(cat "$MARKER" | tr -d '[:space:]')
  if git cat-file -e "${LAST}^{commit}" 2>/dev/null; then
    echo "incremental:$LAST"
  else
    echo "full:invalid-commit"
  fi
else
  echo "full:no-marker"
fi
```

- `full:*` → **フルレビューモード**
- `incremental:<hash>` → **増分レビューモード**

---

## ステップ2: レビュー実行

### フルレビューモードの場合

`git diff main` を取得し、下記「共通レビュー観点」の**全項目**でレビューしてください。

出力冒頭に `[フルレビュー]` と明示してください。

### 増分レビューモードの場合

**フェーズ1（詳細レビュー）**: `git diff <last-commit>` を取得し、下記「共通レビュー観点」の**全項目**でレビューしてください。

**フェーズ2（横断チェック）**: `git diff main` を取得し、以下の横断的観点のみ軽くチェックしてください。

- インターフェース不整合（API境界の型、引数・戻り値の不一致）
- 依存関係の変化（新しいパッケージ追加、アーキテクチャ違反の蓄積）
- パターン一貫性（同種の処理で異なる実装スタイルが混在していないか）
- テストカバレッジ全体（変更量に対してテストが著しく不足していないか）

出力冒頭に `[増分レビュー: <last-commit-short>..HEAD]` と明示してください。

---

## 共通レビュー観点

### アーキテクチャ（最優先）

依存方向: `presentation → application → domain ← infrastructure → integrations`

- `domain/` 配下に Zod・Prisma・HTTP の import がないか
- DTOやバリデーション（`XxxInput`）が `application/validators.ts` にあるか
- 外部SDK が `src/integrations/` 以外で直接 import されていないか
- `features/` 配下で `process.env` を直接参照していないか

### TypeScript

- `as` 型アサーションの不適切な使用がないか（`as const` / テスト内 `as unknown` / `as never` は許容）
- `any` 型を使用していないか
- Zod v4 API を使用しているか（`z.email()` など、`z.string().email()` は旧API）

### バグ・ロジック

- null/undefined アクセス、型の不一致
- ROP パターンの正しい使用（`Ok` / `Err` / `flow()` の連鎖）
- await 忘れ、Promise の未処理

### セキュリティ

- 認証・認可チェックの漏れ
- 入力バリデーションが application 層で行われているか

### テスト

- 新機能・修正に対応するテストが追加されているか
- api-service の変更には `usecase.test.ts` が存在するか
- client の変更には `actions/*.test.ts` / `queries/*.test.ts` が存在するか

---

問題がない場合は「レビューOK」と一言添えてください。問題がある場合はファイル名と行番号を明示してください。

---

## ステップ3: コミット記録

レビュー完了後、以下を実行してください。

```bash
mkdir -p .claude && git rev-parse HEAD > .claude/last-review-commit
```
