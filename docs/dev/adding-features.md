# 機能追加の手引き

新しい機能（feature）を足すときに、どこを読めばよいかの案内です。手順・構成・コード例はここに
複製しません。複製は規約の本体の変更に追従できずに古くなり、古い型紙がそのまま写されてゲートの抜けや
セキュリティ上の欠陥の原因になるためです。規約の本体と参照実装を直接読んでください。

## api-service

| 知りたいこと | 読む場所 |
|---|---|
| 実装順序 | `apps/api-service/AGENTS.md` の「Adding a New Feature (implementation order)」 |
| ディレクトリ構成・各ファイルの役割 | `apps/api-service/AGENTS.md` の「Feature structure」 |
| usecase の書き方（ROP） | `apps/api-service/AGENTS.md` の「Use case pattern (ROP)」 |
| 認証必須ルーター・DI・ログ等の規則 | `apps/api-service/AGENTS.md` の「Key rules」 |
| 他 feature の機能を使う | `apps/api-service/AGENTS.md` の「Feature-to-feature integration (ports + adapter + DI)」 |
| 書くべきテスト | `apps/api-service/AGENTS.md` の「What tests to write (per feature addition)」 |
| 上記に無い細部の規約 | `.claude/rules/api-service.md` |

実装例は参照実装 `apps/api-service/src/features/tasks` の実ファイルを読みます
（`bun run check:feature` がこの構造を他の feature にも要求します）。

- ルーター（認証・入力検証・所有者の渡し方）: `apps/api-service/src/features/tasks/presentation/router.ts`
- 入力検証と DTO: `apps/api-service/src/features/tasks/application/create/validators.ts`
- ステップと usecase: `apps/api-service/src/features/tasks/application/create/steps.ts` / `apps/api-service/src/features/tasks/application/create/usecase.ts`
- 検証・ステップ・整形が揃った usecase: `apps/api-service/src/features/tasks/application/list/usecase.ts`
- リポジトリ抽象と Drizzle 実装: `apps/api-service/src/features/tasks/domain/tasks.repository.ts` / `apps/api-service/src/features/tasks/infrastructure/tasks.repository.drizzle.ts`
- 配線: `apps/api-service/src/container.ts`（登録）/ `apps/api-service/src/app.ts`（`/api/tasks` へのマウント）

### AGENTS.md の手順の前後でやること

- **テーブルを足すなら先にスキーマ**: `packages/database/src/schema/` に定義し、`bun run db:generate` →
  `bun run db:migrate`（詳細は [packages/database/README.md](../../packages/database/README.md)）
- **終わったら**: `bun run arch:check`（依存方向・構文ガード・feature 構造の完全性を含む）と
  `bun run typecheck`。ロジックを変えたら `cd apps/api-service && bun run mutation:diff`
  （コミット済みの差分だけを見る。詳細は [品質ゲート ガイド](./quality-gates.md)）

### 写すときに落としやすい点

どれも typecheck は通るため、ここで気づかないと、ゲートかレビューまで気づけません。

- **所有者はセッションから取る**: 所有者 ID（`ownerId` 等）をリクエストボディやクエリで受けない
  （他人のデータを作成・参照できる IDOR になる）。ハンドラで `c.get("user").id` を usecase に渡し、
  リポジトリは所有者で絞り込む（実例: `tasks.repository.drizzle.ts` の `list` / `getById`）
- **`zValidator` は `@app/shared/http/z-validator` から import する**: `@hono/zod-validator` の直 import は
  `arch:guards` が落とす（ラッパーが 400 の診断ログを付けるため）
- **認証必須ルーターは `createAuthedApp()` と `.use(requireAuth(...))` をセットで使う**: `arch:guards` が検出するのは
  「`createAuthedApp()` を使っているのに `requireAuth` が無い」場合だけ。`createApp()` で作ったルーターには
  認証が掛からず、何にも引っかからない
- **テストは任意ではない**: contract テスト（`__tests__/contract/{feature}.contract.test.ts`）と各 `usecase.ts` の
  co-located テストが無いと `check:feature` が落とす

## 外部SDKが必要な場合

- SDK の薄いラッパーは `apps/api-service/src/integrations/external/` に置く（ここから `features/` は import しない）。
  ラッパーの細則は `.claude/rules/api-service.md` の「外部 SDK（integrations/external）」
- application 層は integrations / infrastructure を import できない（dependency-cruiser が落とす）。必要な機能は
  application 側で型として宣言し、実装を `container.ts` で注入する
- 実例は Better Auth: `apps/api-service/src/integrations/external/auth.ts`（ラッパー）→
  `apps/api-service/src/features/auth/infrastructure/session.ts`（`makeVerifySession`）→
  `apps/api-service/src/features/auth/application/get-session/usecase.ts`（`VerifySession` 型で受け取る）→
  `apps/api-service/src/container.ts` で組み立て
- 他 feature の機能を使う場合は SDK ではなく `integrations/composition/` の adapter を使う
  （`apps/api-service/AGENTS.md` の「Feature-to-feature integration (ports + adapter + DI)」）

## client

- 規約: `apps/client/AGENTS.md` の「Architecture: client」（actions / queries / ui の分け方、SSR と
  クライアント取得の使い分け）と「What tests to write (per feature addition)」。細部は `.claude/rules/client.md`
- 参照実装: `apps/client/features/tasks`
