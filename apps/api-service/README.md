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

### 方針（ROP: Result-Oriented Programming）
- ユースケースは`Result`で成功/失敗を表現し、例外は極力境界層でのみ扱う
- `andThen`/`asyncAndThen`でチェインし、Okだけ次へ進み、Errはショートサーキット
- HTTPレスポンスは Presentation 層で `isOk(result)` + literal status code で変換する

### ステップ関数の基本形
- ファイル先頭に入出力の型エイリアスを置く（ファイルローカル）
- 依存は`makeXxxStep({ ...deps })`で注入する

```ts
// 入出力の型（ファイルローカル）
type CreateUserStepInput = CreateUserInput; // zod推論型など既存型の別名
type CreateUserStepOutput = Result<{ item: { id: number } }, "Conflict" | "Unexpected">;

export function makeCreateUserStep(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  return async function createUserStep(
    i: CreateUserStepInput,
  ): Promise<CreateUserStepOutput> {
    const created = await usersRepository.create(i);
    if (isOk(created)) return ok({ item: { id: created.value.id } });
    if (created.value === "Conflict") return err("Conflict");
    return err("Unexpected");
  };
}
```

### ユースケース（チェイン）の基本形
- 中間結果はOkの`value`のみ次へ渡る
- すべての中間情報を渡したい場合は、オブジェクトで累積（例: `{ input, validated, created }`）

```ts
export function makeCreatePost(deps: { postsRepository: PostsRepository }) {
  const createPostStep = makeCreatePostStep(deps);
  return async function createPost(
    input: CreatePostInput,
  ): Promise<Result<{ item: { id: number } }, "Invalid" | "Unexpected">> {
    return flow<CreatePostInput, "Invalid" | "Unexpected">(input)
      .andThen(validateCreatePost)
      .asyncAndThen(createPostStep)
      .value();
  };
}
```

### バリデーションと型の配置
- **ユースケースの入出力（DTO）はApplication層で定義する**（`CreateXxxInput`など）
- **Domain層の関数はDTOを知らない**（プリミティブな値やDomainオブジェクトを受け取る）
- Application層のバリデータ（`validateXxx`）が、DTOを分解してDomain層の不変条件検証（`validateXxxInvariants`）を呼び出す
- HTTP層で契約スキーマ（`CreateXxxRequestSchema`）のバリデーションは完了しているが、Application層でも型の一致や追加の検証を行う
- ドメイン層は外部ライブラリ（Zod、Prisma、HTTP等）に依存させない

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

詳細は`.cursor/rules/typescript-style.mdc`と`docs/dev/development.md`を参照してください。

#### usecase.ts の型配置ポリシー（統一）
- ユースケースのエラー型や入出力関連の型エイリアスは、原則として「ファイル先頭」に非exportで定義する
- 同一の型を関数シグネチャと`flow`のジェネリクスで複数回利用する場合は、トップレベル型エイリアスを参照する
- 例外は最小限：その関数内だけで完結する一時的な型に限り関数内定義を許容（可読性を損ねない場合）
- 命名はユースケース意図＋`Error`で統一（例: `CreateUserError`/`CreatePostError`/`ListUsersError`/`ListPostsError`/`GetUserError`/`UpdateError`）

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

### ヘルパーの再導入基準
- `fromPromise`のようなヘルパーは、非同期→Result化の重複が目立ってから導入
- `isErr`は型ガードが必要になった時のみ導入（現状は`isOk`で足りている）

---

## Server設計（Hono + DI + Prisma）

### スクリプト（api-service）
```sh
bun run dev              # ホットリロード起動
bun run lint             # Biome
bun run typecheck        # TypeScript
bun run test             # すべてのテスト
bun run test:unit        # ユニット
bun run test:integration # 統合
bun run test:contract    # 契約
bun run coverage         # カバレッジ
```

### DI/コンテナ
- 依存は`src/container.ts`で組み立て、`createApp`でルータへ注入
- DBは`@repo/db`の`prisma`を利用（`@prisma/client`ベース）

### ルーティング/バリデーション
- ルータは`features/*/presentation/`（共通ルートは`routes/`）配下。バリデーションは`sValidator`（`@hono/standard-validator`）でハンドラ直前に実施
- ルータ→ユースケース→ステップの流れで、HTTP/ドメインの責務を分離

主要エンドポイント（例）
```text
GET  /api/health   -> { status: "ok" }
GET  /api/users    -> 一覧
POST /api/users    -> 作成
```
簡易確認:
```sh
curl -s http://localhost:8080/api/health | jq .
```

**注意**: すべてのAPIエンドポイントは `/api` プレフィックスが付いています。Server側では `/api` をベースパスとして設定しているため、内部ルーティングは `/users` などのままで、実際のエンドポイントは `/api/users` になります。Client側は `shared/lib/api.ts` で Hono RPC クライアント (`hc<AppType>`) を使用し、サーバーの型定義から型安全性を確保しています。

### ミドルウェア
- `pinoLogger`（hono-pino）/`secureHeaders`/`cors`/`etag`/`timing`/`prettyJSON(dev)`を共通適用

### 環境変数/設定
- ルートの`.env`を常に読み込む（`src/config.ts`）
- 代表: `PORT`(既定:8080), `NODE_ENV`, `CORS_ORIGIN`, `LOG_PRETTY`, `DATABASE_URL`

### 外部SDK/Integrations
- **外部SDKは必ず`src/integrations/`配下に配置する**
- `@google-cloud/*`、`google-auth-library`、その他の外部サービスSDKは直接使用せず、`integrations`層にラッパー関数として実装
- `middlewares`、`routes`、`features`層から外部SDKを直接importしない
- `integrations`層は外部SDKの薄いラッパーとして、アプリケーション固有の型やエラーハンドリングを提供する

### DB/Prisma
- `packages/database`は`@prisma/client`を利用。`prisma generate`で`node_modules`に生成
- 生成物はGit管理しない（DB操作はルートのスクリプトで実行）

### テスト
- ユニット: ステップ/ユースケース単体の振る舞いを`Result`で検証
- 統合: ルータ〜ユースケース〜リポジトリの結合を確認
- 契約: `__tests__/contract`で Hono RPC (`hc<typeof app>`) によるレスポンス型契約を確認

### API クライアント（Client 側）
- フロントは `hc<AppType>` で型付き RPC クライアントを使用（`apps/client/shared/lib/api.ts`）

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
