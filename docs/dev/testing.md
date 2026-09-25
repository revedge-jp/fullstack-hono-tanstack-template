# テストガイド

新機能追加時に「どこに何のテストを書くか」の案内です。
**書くべきテストの一覧とテストヘルパの使い方は各アプリの AGENTS.md に書いてあり**、ここには複製しません。
手本にする実装は `tasks` feature — 迷ったら下の表の実物を開いてパターンを踏襲してください。

- api-service: [`apps/api-service/AGENTS.md`](../../apps/api-service/AGENTS.md#testing-conventions) の
  「Testing Conventions」（`createFakeApp`・in-memory リポジトリ・What tests to write）
- client: [`apps/client/AGENTS.md`](../../apps/client/AGENTS.md#testing-conventions) の「Testing Conventions」と
  [`.claude/rules/client.md`](../../.claude/rules/client.md) の「actions / queries のテストは `test-helpers/api-mock.ts` を使う」
- テスト層ごとのカバレッジ・ミューテーションの対象: [品質ゲート ガイド](quality-gates.md) の「テスト層と「何をどこでテストするか」」

---

## 書き始めに開く実物

コード例はここに載せない（実物とずれたまま写経される）。同種のテストを書くときは次のファイルを開く。

### api-service

| 書くもの | 実物 | 要点 |
|---|---|---|
| usecase | `apps/api-service/src/features/tasks/application/create/usecase.test.ts` | リポジトリ・ポートをフェイクで注入し、`isOk()` / `isErr()` で絞ってから値を検証する |
| validators | `apps/api-service/src/features/tasks/application/create/validators.test.ts` | `validators.ts` に非自明なロジックがある場合のみ |
| domain | `apps/api-service/src/features/tasks/domain/models.test.ts` | ドメインに振る舞い（値オブジェクト等）がある場合のみ |
| contract | `apps/api-service/src/__tests__/contract/tasks.contract.test.ts` | `createFakeApp` に service と `getSession` を差し替え、本物のミドルウェアスタックを通す。`activity` / `auth` の contract テストは `new Hono().route` で組んでいてミドルウェアを通らないので、新しく書くときは tasks に倣う |
| 400 系（バリデーション） | `apps/api-service/src/__tests__/unit/router.validation.test.ts` | 新ファイルを作らず追記する |
| integration（実 DB） | `apps/api-service/src/__tests__/integration/tasks.int.test.ts` | 各テストを `createTransactionalDb()`（`apps/api-service/src/test-helpers/transactional-db.ts`）で包み、手書きの後始末を書かない |
| リポジトリの fake↔real 適合 | `apps/api-service/src/__tests__/integration/repository-conformance.int.test.ts` | リポジトリを足したら必ず。in-memory と Drizzle の両方に同じテストを流す |
| feature 間 adapter | `apps/api-service/src/integrations/composition/activity-recorder.test.ts` | adapter を足したら必ず。入力の組み立てとポートのエラー型への正規化を検証する |

### client

| 書くもの | 実物 | 要点 |
|---|---|---|
| action | `apps/client/features/tasks/actions/create-task.test.ts` | `createApiMock()` を `@/shared/lib/browser-api-client` に `mock.module` する。`hono/client` のモックを手書きしない |
| query（serverFn） | `apps/client/features/tasks/queries/get-tasks.test.ts` | `createApiMock()` の `apiClientModule` と `reactStartModule` / `reactStartServerModule()` を `mock.module` する |
| E2E | `apps/client/tests/e2e/tasks.spec.ts` | ログイン済み状態は DB シード + 署名済み cookie 注入で作る（Google OAuth を経由しない。`apps/client/tests/e2e/helpers/auth.ts`） |

UI コンポーネント（`ui/` 配下）の単体テストは書かない。データ取得は query テストが、表示は E2E がカバーする。

---

## テスト実行コマンド

```bash
# 全テスト（TEST_DATABASE_URL へのマイグレーション込み）
bun run test

# ユニットテストのみ（DB 不要）
bun run test:unit

# 統合テスト（test DB 必要: bun run db:up:test）
bun run test:integration

# E2E（dev モード / prod-shape モード）
bun run test:e2e
bun run test:e2e -- --prod-shape

# 単一ファイル（api-service）
cd apps/api-service && bun test src/features/tasks/application/create/usecase.test.ts

# 単一ファイル（client）
cd apps/client && bun test features/tasks/actions/create-task.test.ts
```
