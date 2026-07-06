## クイックスタート（サーバー単体）
依存インストール:
```sh
bun install
```

起動:
```sh
cd apps/api-service
bun run dev
```

open http://localhost:8080

ルートのDB操作や一括開発については、リポジトリの`README.md`を参照してください。

## アプリケーション層のステップ設計ガイド

### 方針（ROP: Result-Oriented Programming、neverthrow — ADR-005）
- ユースケースは `ResultAsync` で成功/失敗を表現し、例外は境界層（infrastructure / presentation）でのみ扱う
- `okAsync().andThen()` でチェインし、Ok だけ次へ進み、Err はショートサーキット
- HTTP レスポンスは Presentation 層の `toHttp(c, result, errorMap)`（`shared/http/to-http.ts`）で変換する
- `usecase.ts` は `async` / `try-catch` 禁止（`arch:guards` で強制）。非同期の副作用は steps に委譲する

### ステップ関数の基本形（実例: `features/tasks/application/create/steps.ts`）
- ファイル先頭に入出力の型エイリアスを置く（ファイルローカル）
- 依存は`makeXxxStep({ ...deps })`で注入する
- リポジトリは `ResultAsync<T, E>` を返す（`Promise<Result<T, E>>` ではない）

```ts
import type { ResultAsync } from "neverthrow";

type CreateTaskStepOutput = ResultAsync<{ item: { id: string } }, "Conflict" | "Unexpected">;

export function makeCreateTaskStep(deps: { tasksRepository: TasksRepository }) {
  return function createTaskStep(input: CreateTaskValidated): CreateTaskStepOutput {
    return deps.tasksRepository
      .create(input)
      .map((task) => ({ item: { id: task.id } }));
  };
}
```

### ユースケース（チェイン）の基本形（実例: `features/tasks/application/create/usecase.ts`）
- 中間結果はOkの`value`のみ次へ渡る
- すべての中間情報を渡したい場合は、オブジェクトで累積（例: `{ input, validated, created }`）

```ts
import { okAsync, type ResultAsync } from "neverthrow";

type CreateTaskError = "Conflict" | "Invalid" | "Unexpected"; // ファイル先頭・非export

export function makeCreateTask(deps: { tasksRepository: TasksRepository }) {
  const createTaskStep = makeCreateTaskStep(deps);
  return function createTask(
    input: CreateTaskInput,
  ): ResultAsync<{ item: { id: string } }, CreateTaskError> {
    return okAsync(input)
      .andThen(validateCreateTask) // sync な Result を返すバリデータ
      .andThen(createTaskStep);    // ResultAsync を返すステップ
  };
}
```

### バリデーションと型の配置
- **ユースケースの入出力（DTO）はApplication層で定義する**（`CreateXxxInput`など）
- **Domain層の関数はDTOを知らない**（プリミティブな値やDomainオブジェクトを受け取る）
- Application層のバリデータ（`validateXxx`）が、DTOを分解してDomain層の不変条件検証（`validateXxxInvariants`）を呼び出す
- HTTP層で契約スキーマ（`CreateXxxRequestSchema`）のバリデーションは完了しているが、Application層でも型の一致や追加の検証を行う
- ドメイン層は外部ライブラリ（Zod、Drizzle、HTTP等）に依存させない

### 型安全性と型アサーション

型アサーション（`as`キャスト）の使用は原則禁止です。型安全性を損なうため、以下の代替手段を優先してください:

- **型ガード関数**: 実行時バリデーションと型の絞り込みを同時に行う（推奨）
- **型定義の修正**: 型定義を修正して正しい型推論を実現する
- **ジェネリクス**: 型パラメータを活用して型安全性を保つ

許容される例外的なケース:
- `as const`（リテラル型の固定）
- `import { X as Y }`（名前の変更）
- テストコードでの`as unknown`
- 型生成専用ファイルでの`as never`
- エラーハンドリングでの型ガード（`typeof`チェックと組み合わせて使用）

詳細は`docs/dev/coding-standards.md`と`docs/dev/development.md`を参照してください。

#### usecase.ts の型配置ポリシー（統一）
- ユースケースのエラー型や入出力関連の型エイリアスは、原則として「ファイル先頭」に非exportで定義する
- 同一の型を関数シグネチャとチェーンのジェネリクスで複数回利用する場合は、トップレベル型エイリアスを参照する
- 例外は最小限：その関数内だけで完結する一時的な型に限り関数内定義を許容（可読性を損ねない場合）
- 命名はユースケース意図＋`Error`で統一（例: `CreateTaskError`/`ListTasksError`/`GetTaskError`/`AdvanceTaskError`）

### ステップファイルの分割基準
- 1ファイルにまとめる（推奨条件）
  - ステップ数が2〜3、200行未満、責務が密に関連
- 分割する（推奨条件）
  - ステップが4つ以上、責務/変更頻度/副作用が明確に異なる、単体テストを個別に書きたい

構成例（分割時）
```
application/create/steps/
  validate.ts
  check-duplication.ts
  persist.ts
  publish-event.ts
  index.ts  // ステップの束ね/compose補助
```

### エラー設計
- ユースケース単位でエラーを文字列リテラルのユニオンで明示（例: `"Invalid" | "Unexpected"`）
- ステップ横断で揃えると可読性・保守性が上がる

### 例外の Result 化
- DB 等の Promise は infrastructure 層で `ResultAsync.fromPromise(promise, errorMapper)` でラップする
- 判定は neverthrow の型ガード `result.isOk()` / `result.isErr()` を使う（Err 側の値は `result.error`）

---

## Server設計（Hono + DI + Drizzle）

### スクリプト（api-service）
```sh
bun run dev              # ホットリロード起動
bun run lint             # oxlint + oxfmt --check
bun run typecheck        # TypeScript
bun run test             # すべてのテスト
bun run test:unit        # ユニット
bun run test:integration # 統合
bun run test:contract    # 契約
bun run coverage         # カバレッジ
```

### DI/コンテナ
- 依存は`src/container.ts`で組み立て、`createApp`でルータへ注入
- DBは`@repo/db`の`createDb()`を利用（Drizzle ORM + postgres-js）

### ルーティング/バリデーション
- ルータは`features/*/presentation/`（共通ルートは`routes/`）配下。バリデーションは`zValidator`（`@hono/zod-validator`）でハンドラ直前に実施
- ルータ→ユースケース→ステップの流れで、HTTP/ドメインの責務を分離

主要エンドポイント（例）
```text
GET    /api/health      -> { status: "ok" }（DB 疎通込み。/api/health/live は DB 非依存）
GET    /api/me          -> セッションのユーザー情報
GET    /api/tasks       -> 一覧（要認証・keyset ページネーション）
POST   /api/tasks       -> 作成（要認証）
PATCH  /api/tasks/:id   -> ステータス遷移（要認証）
DELETE /api/tasks/:id   -> 削除（要認証）
```
簡易確認:
```sh
curl -s http://localhost:8080/api/health | jq .
```

**注意**: すべてのAPIエンドポイントは `/api` プレフィックスが付いています（`app.ts` がマウント時に付与）。Client側はブラウザでは `hc<AppType>("/")`、SSR では `shared/lib/api-client.ts` の in-process クライアントを使用し、サーバーの型定義から型安全性を確保しています。

### ミドルウェア
- `requestId`/`requestLogger`（自作・requestId 束ね pino 子ロガー）/`timing`/`secureHeaders`/`cors`/`bodyLimit`(1MiB, 413)/`prettyJSON(dev)` を `app.ts` で共通適用
- 認証必須ルーターは `createAuthedApp()` + `.use(requireAuth(deps.getSession))` をセットで使う（`middlewares/require-auth.ts`。付け忘れは `arch:guards` が検出）

### 環境変数/設定
- ルートの`.env`を常に読み込む（`src/config.ts`）
- 代表: `PORT`(既定:8080), `NODE_ENV`, `CORS_ORIGIN`, `LOG_PRETTY`, `DATABASE_URL`

### 外部SDK/Integrations
- **外部SDKは必ず`src/integrations/`配下に配置する**
- `@google-cloud/*`、`google-auth-library`、その他の外部サービスSDKは直接使用せず、`integrations`層にラッパー関数として実装
- `middlewares`、`routes`、`features`層から外部SDKを直接importしない
- `integrations`層は外部SDKの薄いラッパーとして、アプリケーション固有の型やエラーハンドリングを提供する

### DB/Drizzle
- `packages/database`はDrizzle ORMを利用。スキーマは`src/schema/*.ts`のTypeScriptファイルで定義
- マイグレーションは`drizzle/`配下にGit管理（`bun run db:generate`で生成、`db:migrate`で適用）

### テスト
- ユニット: ステップ/ユースケース単体の振る舞いを`Result`で検証
- 統合: ルータ〜ユースケース〜リポジトリの結合を確認
- 契約: `__tests__/contract`で Hono RPC (`hc<typeof app>`) によるレスポンス型契約を確認

### API クライアント（Client 側）
- ブラウザは `hc<AppType>("/")` で相対 URL の型付き RPC クライアントを使用（実例: `apps/client/features/tasks/actions/create-task.ts`）
- SSR（loader / createServerFn）は `apps/client/shared/lib/api-client.ts` の in-process クライアントを使用（ADR-001）

---

## クリーンアーキテクチャ方針とルール

### 層の責務
- presentation/routes: HTTP I/O とバリデーションのみ。service を呼び出す。
- features/application: ユースケース/ステップ。外部I/Fはポート（interface/type）のみ依存。**DTOを定義**。
- features/domain: ドメインモデル/リポジトリ抽象。**純粋性を維持（DTO非依存）**。
- features/infrastructure: リポジトリ実装/外部サービスアダプタ。
- integrations: 外部SDKの薄いラッパ（GCP等）。

### 依存の向き（強制）
- presentation/routes → application → (domain | ports) → infrastructure → integrations
- 逆向きは禁止（dependency-cruiser で検査）。

### 代表ポリシー
- application から infrastructure/integrations へ直参照禁止（ポート経由で依存を注入）。
- domain は外部ライブラリ（HTTP/SDK/バリデーション等）への依存禁止。**Application層のDTOにも依存しない**。
- features 配下での process.env 直参照禁止（config 経由）。
- application 層で fetch/axios/@google-cloud/* の直使用禁止。
- **外部SDK（@google-cloud/*、google-auth-library等）は必ず`integrations`層に配置し、他層から直接importしない**。
- Web フレームワーク（hono 等）は `app.ts` と `features/*/presentation/router.ts` に閉じ込める。

### 自動チェック
- 依存規約: `dependency-cruiser.config.cjs`
- 構文/配置ガード: `scripts/check/arch-guards.sh`
- 一括実行: `bun run arch:check`（`bun run check-all` に含まれる）

外部SDK（メール送信、外部APIクライアント等）が必要な場合は、Ports 定義 → `integrations` 実装 → Infrastructure 実装の順で追加する。詳細は [機能追加ガイド](../../docs/dev/adding-features.md#外部sdkが必要な場合) を参照。

---

## 機能追加の手順

新しい機能を追加する際の詳細な手順については、[機能追加ガイド](../../docs/dev/adding-features.md)を参照してください。
