# システムアーキテクチャ

このドキュメントでは、本テンプレートのシステム全体のアーキテクチャ、リクエストの流れ、デプロイフローについて説明します。

## 全体構成

client（TanStack Start）と api-service（Hono）はモノレポ上は別アプリだが、
デプロイ単位は **単一の Cloudflare Worker**。client のサーバーエントリ
（`apps/client/app/server.ts`）が api-service の Hono アプリをインポートしてバンドルし、
`/api/*` へのリクエストを Worker 内でルーティングする。

```mermaid
graph TB
    Internet[インターネット]
    Worker["Cloudflare Worker<br/>(client + api-service を単一バンドル)"]
    Assets[Static Assets<br/>ビルド済みクライアント資産]
    DB[(PostgreSQL<br/>外部マネージドDB)]

    Internet --> Worker
    Worker --> Assets
    Worker -->|"Hyperdrive / 直接続"| DB

    style Worker fill:#e1f5ff
    style DB fill:#ffe1f5
    style Assets fill:#fff5e1
```

## アプリケーション構成

### Client (`apps/client`)

- **役割**: TanStack Start アプリケーション（SSR + CSR）
- **技術スタック**: TanStack Start, React 19, Tailwind v4, shadcn/ui
- **アーキテクチャ**: FSD (Feature-Sliced Design) ライクな構成
  - `features` 間の直接参照は禁止（dependency-cruiser で強制）。共通コンポーネントは `shared` に昇格させる。
- **API 呼び出し**:
  - ブラウザ: 相対 URL の Hono RPC クライアント（`hc<AppType>("/")`）→ 同一 Worker の `/api/*` へ
  - SSR（loader / createServerFn）: CF Workers では同一オリジンへの `fetch()` が
    自分自身の fetch ハンドラーへループバックしないため（[ADR-001](adr-001-cf-workers-session-check.md)）、
    AsyncLocalStorage 経由で api-service の container を直接呼び出す
    （`apps/client/shared/lib/server-container.ts`）

### Server (`apps/api-service`)

- **役割**: REST API（Hono）。単体でも Bun で起動可能（`bun run dev`）
- **技術スタック**: Hono, Drizzle ORM, neverthrow（ROP）、クリーンアーキテクチャ
- **依存ルール**（dependency-cruiser + arch-guards で強制）:
  - **Domain層**: 外部ライブラリ（フレームワーク、DB、バリデーションライブラリ等）への依存禁止。Application層のDTOにも依存しない（純粋な値のみ）。
  - **Application層**: ユースケースの入出力（DTO）を定義。Domain層の純粋関数を利用してロジックを実行。
  - **Infrastructure層**: DB操作の実装（Drizzle）。エラーは `ResultAsync.fromPromise` でラップ。
  - **Integrations層**: `external/`（サードパーティSDKの薄いラッパー）と `composition/`（feature間連携アダプタ）に分離。
  - 型定義の共有は Hono RPC (`AppType`) 経由で行う。
- **ロギング**: `@repo/logging`（pino）。Workers ランタイムでは console ベースの
  Workers-safe stream、Bun 開発時は pino-pretty、Bun/Node 本番では stdout NDJSON。

詳細は [CLAUDE.md](../../CLAUDE.md) のアーキテクチャ節と [開発ガイド](../dev/development.md) を参照。

## データベース

- **PostgreSQL**（外部マネージドDB。Neon / Supabase / Cloud SQL 等）
- **接続**: `DATABASE_URL`（本番は Workers Secret）。ローカルは Docker（`bun run db:up`）
- **マイグレーション**: drizzle-kit（`bun run db:generate` / `db:migrate`）

## デプロイフロー

```mermaid
graph LR
    Main[mainブランチ<br/>push/merge]
    CI[CI Pipeline<br/>Lint / Typecheck / Test<br/>品質ゲート / Arch Check]
    Stg["deploy (staging)<br/>db:migrate → wrangler deploy --env staging"]
    Tag[v*タグ push]
    Prod["deploy (production)<br/>db:migrate → wrangler deploy --env production"]

    Main --> CI
    Main --> Stg
    Tag --> Prod

    style Main fill:#e1f5ff
    style CI fill:#fff5e1
    style Stg fill:#e1ffe1
    style Prod fill:#ffe1f5
```

- ワークフロー: `.github/workflows/deploy.yml`
- 必要な GitHub Secrets: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `DATABASE_URL`
- アプリの環境変数は `apps/client/wrangler.jsonc` の `vars` と Workers Secrets で管理

詳細は [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) を参照してください。

## データフロー

### ユーザーリクエストの流れ

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant Worker as Cloudflare Worker
    participant Hono as api-service (同一バンドル)
    participant DB as PostgreSQL

    User->>Worker: HTTP リクエスト
    alt /api/* へのリクエスト
        Worker->>Hono: Worker 内ルーティング
        Hono->>DB: Drizzle 経由
        DB-->>Hono: データ
        Hono-->>User: JSON レスポンス
    else ページリクエスト
        Worker->>Worker: TanStack Start SSR
        Note over Worker,Hono: loader からは AsyncLocalStorage の<br/>container 経由で service を直接呼ぶ<br/>(HTTPループバック不可のため)
        Worker-->>User: HTML レスポンス
    end
```

## 参照ドキュメント

- [開発ガイド](../dev/development.md) - 各アプリケーションの開発方法
- [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) - デプロイの詳細手順
- [ADR-001: CF Workers でのセッション検証（SSR fetch 制約）](adr-001-cf-workers-session-check.md)
- [ドメインモデル指針](domain-model.md) - DMMFベースのコマンド/イベント/状態遷移の整理
