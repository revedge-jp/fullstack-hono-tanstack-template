# 開発ガイド

このドキュメントでは、fullstack-hono-tanstack-template の各アプリケーション・パッケージの開発方法について説明します。

## 目次

- [Client](#client)
- [Server](#server)
- [DB](#db)
- [パッケージ](#パッケージ)
- [開発時のコマンド](#開発時のコマンド)

## Client

### 概要

TanStack Start を使用したフロントエンドアプリケーション（SSR + CSR）。Feature-Sliced Design (FSD) ライクなアーキテクチャを採用しています。

詳細は [apps/client/README.md](../../apps/client/README.md) を参照してください。

### FSD（Feature-Sliced Design）構造

クライアントアプリケーションは FSD アーキテクチャに基づいて構成されています。

```
apps/client/
├── app/                    # TanStack Start（routes / router / server entry）
│   ├── routes/             # ファイルベースルーティング（_authenticated 等）
│   └── server.ts           # Worker の fetch ハンドラー（api-service をバンドル）
├── features/               # 機能単位のスライス
│   ├── tasks/
│   │   ├── actions/        # mutation: ブラウザから Hono RPC を直接呼ぶ平関数
│   │   ├── queries/        # データ取得（SSR loader 用 createServerFn / queryOptions）
│   │   ├── ui/             # UI コンポーネント
│   │   └── index.ts        # パブリック API
├── shared/                 # 共有レイヤ（横断関心）
│   └── lib/                # api-client 等
└── components/             # 汎用 UI コンポーネント
    └── ui/                 # shadcn/ui コンポーネント
```

#### レイヤー規則

- **features**: 機能単位のスライス。`actions`、`queries`、`ui` に分割
- **shared**: 横断関心（config, lib, utils, styles）を配置
- **components**: 汎用的な UI コンポーネント（shadcn/ui など）

#### 依存関係ルール

- `shared` から `features` への参照は禁止（dependency-cruiser で検証）
- `features` 間の直接参照は禁止（dependency-cruiser で検証、feature 名は自動導出）

### データ取得（SSR ファースト）

- 基本はルートの `loader` + `createServerFn` でサーバーサイド取得し、初回表示のローディングを無くす
- ユーザー操作で動的に変わるデータのみ TanStack Query の `useQuery` を使う
- パターンの詳細は [AGENTS.md](../../AGENTS.md#architecture-client) を参照

### shadcn/ui

UI コンポーネントは shadcn/ui をベースにしています。

- コンポーネントは `apps/client/components/ui/` に配置
- `components.json` で設定を管理
- 用途により未使用エクスポートがありえるため、knip 除外方針に準拠（`knip.json` で除外設定）

使用方法:

```bash
cd apps/client
npx shadcn@latest add button
```

### API クライアント

クライアントとサーバー間の通信は、Hono RPC (`hc<AppType>`) と `shared/lib/api.ts` で実現しています。

#### 仕組み

1. **api-service**: ルート定義から `AppType` を `export type` する
2. **shared/lib/api.ts**: `hc<AppType>(baseUrl)` で型付き RPC クライアントを生成

#### 使用例

```typescript
// apps/client/shared/lib/api.ts
import type { AppType } from "api-service";
import { hc } from "hono/client";

export const client = hc<AppType>(baseUrl);

// 使用側
const res = await client.api.users.$get();
if (res.status === 200) {
  const json = await res.json(); // { items: User[] } に型付き
}
```

**型安全性**:
- リクエスト/レスポンスの型はサーバーの Zod スキーマから自動推論（単一ソース）
- `api-service` の `build` スクリプトが `.d.ts` を生成（`tsc --emitDeclarationOnly`）

詳細は [apps/client/README.md](../../apps/client/README.md) を参照してください。

## Server

### 概要

Hono を使用した REST API サーバー。クリーンアーキテクチャと Result 指向（ROP）設計を採用しています。

詳細は [apps/api-service/README.md](../../apps/api-service/README.md) を参照してください。

### Hono フレームワーク

Hono は軽量で高速な Web フレームワークです。

- ルーティング: `features/*/presentation/` 配下（共通ルートは `routes/`）
- バリデーション: `zValidator`（`@hono/zod-validator`）で Zod スキーマを使用
- ミドルウェア: 共通ミドルウェア（requestId・requestLogger・secureHeaders・cors・bodyLimit 1MiB 等）は `app.ts` で適用。横断ミドルウェア（requireAuth・requestLogger）は `src/middlewares/` 配下
- ルータ: RegExpRouter を採用
- 観測ログ: 自作の `requestLogger` ミドルウェア（`src/middlewares/request-logger.ts`）が requestId を束ねた pino 子ロガーを context に載せ、method / path / status / durationMs を構造化 JSON で出力（`c.get("logger")` で参照）

### DDD/クリーンアーキテクチャ

サーバーアプリケーションはクリーンアーキテクチャに基づいて構成されています。

```
apps/api-service/src/
├── routes/                 # 共通ルート（health など）
├── features/               # 機能単位
│   └── users/
│       ├── application/    # ユースケース・ステップ
│       │   ├── create/
│       │   │   ├── steps.ts       # ステップ関数
│       │   │   └── usecase.ts    # ユースケース（チェイン）
│       ├── domain/         # ドメインモデル・リポジトリ抽象
│       ├── infrastructure/ # リポジトリ実装
│       └── presentation/   # HTTP I/O とバリデーション（ルーター）
├── integrations/          # 外部SDKの薄いラッパー
└── container.ts           # DI コンテナ
```

#### 層の責務

- **presentation** / **routes**: HTTP I/O とバリデーションのみ。service を呼び出す
- **application**: ユースケース/ステップ。外部I/Fはポート（interface/type）のみ依存
- **domain**: ドメインモデル/リポジトリ抽象
- **infrastructure**: リポジトリ実装/外部サービスアダプタ
- **integrations**: 外部SDKの薄いラッパー（GCP等）

- `features/users/domain/users.repository.ts` でドメイン不変条件の検証を行います。

#### 依存の向き

```
presentation/routes → application → (domain | ports) → infrastructure → integrations
```

逆向きは禁止（dependency-cruiser で検査）。

### 型安全性と型アサーション

TypeScriptの型安全性を維持するため、型アサーション（`as`キャスト）の使用は原則禁止です。

#### 禁止事項

- **安易な`as`キャスト**: 型エラーを回避するために`as`を使うことは禁止
- **`as any`**: 型チェックを完全に回避するため、使用禁止
- **`as unknown as Type`**: 型安全性を損なうため、使用禁止

#### 推奨される代替手段

1. **型ガード関数**: 実行時バリデーションと型の絞り込みを同時に行う
   ```typescript
   function isValidJobStatus(value: string): value is JobStatus {
     return value === "queued" || value === "processing" || value === "done";
   }
   
   if (!isValidJobStatus(row.status)) {
     throw new Error(`Invalid job status: ${row.status}`);
   }
   // ここでrow.statusはJobStatus型に絞り込まれている
   ```

2. **型定義の修正**: 型定義を修正して正しい型推論を実現する
3. **ジェネリクス**: 型パラメータを活用して型安全性を保つ

#### 許容される例外的なケース

以下のケースでは`as`キャストの使用が許容されます:

- `as const`: リテラル型の固定（例: `status: 404 as const`）
- `import { X as Y }`: 名前の変更（例: `import { tasks as tasksTable }`）
- テストコードでの`as unknown`: 型チェックを回避する必要がある場合
- 型生成専用ファイルでの`as never`: 型生成のためのダミー値
- エラーハンドリングでの型ガード: `typeof`チェックと組み合わせて使用（例: `e as { code?: string }`）

詳細は[コーディング規約](coding-standards.md)と [ADR-003](../architecture/adr-003-as-type-assertion-policy.md) を参照してください。

#### Result 型（[neverthrow](https://github.com/supermacro/neverthrow)、[ADR-005](../architecture/adr-005-neverthrow-for-error-handling.md)）

```typescript
import type { Result, ResultAsync } from "neverthrow";
```

- `Result<T, E>` / `ResultAsync<T, E>`: 成功時 `T`・失敗時 `E`（文字列リテラルのユニオン）
- 判定は `result.isOk()` / `result.isErr()`。値の取得は成功側 `result.value`、失敗側 `result.error`

#### ステップ関数

ファイル先頭に入出力の型エイリアスを置く（ファイルローカル）:

```typescript
type CreateUserStepInput = CreateUserInput;
type CreateUserStepOutput = ResultAsync<{ item: { id: number } }, "Conflict" | "Unexpected">;

export function makeCreateUserStep(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  return function createUserStep(i: CreateUserStepInput): CreateUserStepOutput {
    return usersRepository.create(i).map((created) => ({ item: { id: created.id } }));
  };
}
```

#### ユースケース（チェイン）

`okAsync().andThen()` チェーンでステップを連結する（`usecase.ts` は `async`/`try-catch` 禁止）:

```typescript
import { okAsync, type ResultAsync } from "neverthrow";

type CreateUserError = "Conflict" | "Invalid" | "Unexpected";

export function makeCreateUser(deps: { usersRepository: UsersRepository }) {
  const createUserStep = makeCreateUserStep(deps);
  return function createUser(
    input: CreateUserInput
  ): ResultAsync<{ item: { id: number } }, CreateUserError> {
    return okAsync(input)
      .andThen(validateCreateUser)
      .andThen(createUserStep);
  };
}
```

- `andThen`: 同期・非同期どちらの Result 変換も受け付ける（バリデータは同期 `Result`、ステップは `ResultAsync` を返す）
- `map` / `mapErr`: 成功値・エラー値それぞれの変換
- presentation 層では `toHttp(c, result, errorMap, okStatus?)`（`apps/api-service/src/shared/http/to-http.ts`）でまとめて HTTP レスポンスに変換する

詳細は [apps/api-service/README.md](../../apps/api-service/README.md) を参照してください。

### 外部SDK/integrations層

外部SDKは必ず`src/integrations/`配下に配置します。

- `@google-cloud/*`、`google-auth-library`、その他の外部サービスSDKは直接使用せず、`integrations`層にラッパー関数として実装
- `middlewares`、`routes`、`features`層から外部SDKを直接importしない
- `integrations`層は外部SDKの薄いラッパーとして、アプリケーション固有の型やエラーハンドリングを提供する

実装例:
- `src/integrations/google-auth.ts`: Google OIDC認証SDKのラッパー

詳細は [apps/api-service/README.md](../../apps/api-service/README.md#外部sdkintegrations) を参照してください。

## DB

### 概要

Drizzle ORM を使用したデータベース管理。PostgreSQL を想定しています。

### データベースの立ち上げ

開発環境では Docker Compose を使用して PostgreSQL を起動します。

```bash
# 本番/テストDBを起動
bun run db:up:all

# 本番DBのみ起動
bun run db:up

# テストDBのみ起動
bun run db:up:test
```

Docker Compose の設定:
- 本番DB: ポート `5432`、データベース名 `app_db`、ユーザー名 `postgres`、パスワード `postgres`
- テストDB: ポート `5433`、データベース名 `app_db`、ユーザー名 `postgres`、パスワード `postgres`

**注意**: 開発環境では `postgres` ユーザーを使用しますが、本番環境では `appuser` ユーザーを使用します。

### マイグレーション

```bash
# スキーマ変更からマイグレーションファイルを生成（drizzle-kit generate）
bun run db:generate

# マイグレーションを適用（drizzle-kit migrate）
bun run db:migrate
```

スキーマは `packages/database/src/schema/` の TypeScript ファイルで定義します。

### Drizzle Studio

データベースの内容を確認するには Drizzle Studio を使用します。

```bash
bun run db:studio
```

### Drizzle の使用方法

`packages/database` パッケージから DB インスタンスとスキーマをインポートして使用します。

```typescript
import { createDb, tasks } from "@repo/db";

const { db } = createDb(config.databaseUrl);
const rows = await db.query.tasks.findMany();
```

詳細は [packages/database](../../packages/database/README.md) を参照してください。

## パッケージ

### server で使用

以下のパッケージは server で使用します。

- **`@repo/db`**: Drizzle スキーマ/クライアントのラッパ
- **`neverthrow`** (npm): Result 型ユーティリティ（[ADR-005](../architecture/adr-005-neverthrow-for-error-handling.md)）

### その他のパッケージ

- **`@repo/typescript-config`**: TypeScript 設定の共有
- **`@repo/tailwind-config`**: Tailwind CSS 設定の共有

### TypeScript のバージョン方針（意図的な分離）

| 場所 | バージョン | 理由 |
|---|---|---|
| ルート `package.json` | `6.0.3`（安定版） | dependency-cruiser / knip が TypeScript の **JS コンパイラ API** を必要とする。ネイティブ版（7.x / tsgo）にすると **depcruise が 0 modules で静かに空回りする**（`bun run arch:selftest` がこれを検出する）。TS 7.1 の安定プログラマティック API と各ツールの対応を待って統一する（#26） |
| 各ワークスペース | `7.0.2`（ネイティブ tsgo） | `tsc --noEmit` の typecheck が大幅に高速。コンパイラ API は使わないため問題ない |

ツールチェーン互換問題が出た場合は、各ワークスペースの `typescript` を `6.0.3` に
揃えれば安定版に戻せる（typecheck が遅くなる以外の影響はない）。
ルートを 7.x に上げる場合は、必ず `bun run arch:selftest` が通ることを確認すること。

### パッケージ詳細

#### `@repo/db`

Drizzle スキーマとクライアントのラッパー。

- **スキーマ**: `packages/database/src/schema/*.ts`
- **エクスポート**: `createDb()`、各テーブル定義、`Db*` 型
- **使用例**:
  ```typescript
  import { createDb, tasks, type DbTask } from "@repo/db";

  const { db } = createDb(databaseUrl);
  const rows = await db.query.tasks.findMany();
  ```

#### `neverthrow`

Result 型ユーティリティ（ROP パターン用、npm パッケージ）。

- **エクスポート**: `Result<T, E>`, `ResultAsync<T, E>`, `ok()`, `err()`, `okAsync()`, `errAsync()`
- **使用例**:
  ```typescript
  import { okAsync } from "neverthrow";

  const result = okAsync(input)
    .andThen(validate)
    .andThen(process);
  ```

詳細は各パッケージの `package.json` と `src/index.ts` を参照してください。

## 開発時のコマンド

### knip（未使用コード検出）

未使用のコードや依存関係を検出します。

```bash
# 未使用コードの検出
bun run knip

# 自動修正（削除）
bun run knip:fix
```

設定は `knip.json` で管理。shadcn 配下の UI コンポーネントは未使用エクスポート/型を除外。

詳細は [開発コマンド詳細](dev-commands.md) を参照してください。

### madge（依存関係分析）

依存関係の循環や孤立ファイルを検出します。

```bash
# 循環依存の検出
bun run dep:cycles

# 孤立ファイル/依存の検出
bun run dep:orphans

# 依存グラフの生成
bun run dep:graph
```

### steiger（FSD検証）

Feature-Sliced Design のルールを検証します。

```bash
bun run arch:fsd
```

設定は `steiger.config.mjs` で管理。FSD の推奨設定を使用。

### depcruise（依存ルール検証）

クリーンアーキテクチャの依存ルールを検証します。

```bash
bun run arch:dc
```

設定は `dependency-cruiser.config.cjs` で管理。

### 手作りスクリプト

#### sync-main

`origin/main` へ追従（rebase 既定、DB/型チェックまで自動）。

```bash
bun run sync-main
```

#### check-all

Lint/Type/Test/Architecture を差分限定で一括実行。

```bash
bun run check-all
```

#### arch-guards

構文/配置ガード（export */class/interface 禁止、層間依存や env 参照のガード 等）。

```bash
bun run arch:guards
```

#### arch:check

アーキ規約（依存・FSD・knip）一式を実行。

```bash
bun run arch:check
```

### Hono ドキュメント閲覧

Hono の公式ドキュメントを閲覧・検索できます。

```bash
cd apps/api-service

# ドキュメント閲覧
bunx hono docs

# ドキュメント検索
bunx hono search middleware --pretty
```

| コマンド | 目的 | 備考 |
| --- | --- | --- |
| `bunx hono docs` | ドキュメント閲覧 | `bunx hono docs /docs/guides/basics` など |
| `bunx hono search <query>` | ドキュメント検索 | `--pretty` で整形表示 |

## 環境変数

### 開発環境

開発環境では、ルートの `.env` ファイルを使用します（`dotenv -e .env`）。

必須:
- `DATABASE_URL`: データベース接続URL（例: `postgresql://postgres:postgres@localhost:5432/app_db?schema=public`）
- `TEST_DATABASE_URL`: テスト用データベース接続URL（例: `postgresql://postgres:postgres@localhost:5433/app_db?schema=public`）

**注意**: Docker Compose で起動する場合、デフォルトではユーザー名 `postgres`、パスワード `postgres`、データベース名 `app_db` になります。

オプション（各アプリケーション）:
- Server: `PORT`（既定: 8080）, `NODE_ENV`, `CORS_ORIGIN`, `LOG_PRETTY`
- Client: なし（API はインプロセス呼び出しのためベース URL 不要）

### 本番環境

本番環境（Cloudflare Workers）の環境変数は `alchemy.run.ts` の Worker `bindings` で設定します
（非機密は文字列、機密は `alchemy.secret(...)`。詳細は [環境変数ガイド](environment-variables.md)）。

- `DATABASE_URL`: Workers Secret として登録

**環境変数を追加する際の手順**は [環境変数ガイド](environment-variables.md) を参照してください。詳細な一覧や本番・CI への反映方法も同ドキュメントに記載しています。

## 参照ドキュメント

- [環境変数ガイド](environment-variables.md) - 環境変数一覧と追加フロー
- [システムアーキテクチャ](../architecture/architecture.md) - システム全体の構成
- [開発コマンド詳細](dev-commands.md) - よく使うコマンドの詳細説明
- [apps/client/README.md](../../apps/client/README.md) - Client 詳細
- [apps/api-service/README.md](../../apps/api-service/README.md) - Server 設計ガイド

