# apps/client

Next.js (App Router) フロントエンドアプリケーション。

## 起動

```sh
bun run dev
# http://localhost:3000
```

## 依存関係

- `@repo/ui`: 共有UI（peer: react/react-dom）
- `@repo/db`: Prismaモデル（必要に応じて）

## スタイル

- Tailwind v4（`@tailwindcss/postcss`）
- 共有スタイルは`@repo/ui`参照

## FSD（Feature-Sliced Design）構造

クライアントアプリケーションは Feature-Sliced Design (FSD) アーキテクチャに基づいて構成されています。

```
apps/client/
├── app/                    # Next.js App Router（pages）
├── features/               # 機能単位のスライス
│   └── users/
│       ├── actions/        # Server Actions
│       ├── queries/        # データ取得ロジック
│       ├── ui/             # UI コンポーネント
│       └── index.ts        # パブリック API
├── widgets/                # 複合的な UI ブロック
├── shared/                 # 共有レイヤ（横断関心）
│   └── lib/
│       └── api.ts          # API クライアント設定
└── components/            # 汎用 UI コンポーネント
    └── ui/                 # shadcn/ui コンポーネント
```

### レイヤー規則

- **features**: 機能単位のスライス。`actions`、`queries`、`ui` に分割
- **widgets**: 複数の features を組み合わせた複合的な UI ブロック
- **shared**: 横断関心（config, api, lib, utils, styles）を配置
- **components**: 汎用的な UI コンポーネント（shadcn/ui など）

### 依存関係ルール

- `shared` から `features` への参照は禁止（dependency-cruiser で検証）
- `features` 間の直接参照は警告（必要に応じて `widgets` 経由）
- 型付き API クライアントは `shared/lib/api.ts` で一元管理

詳細は [開発ガイド - Client](../../docs/dev/development.md#client) を参照してください。

## shadcn/ui

UI コンポーネントは shadcn/ui をベースにしています。

### 使用方法

コンポーネントを追加する場合:

```bash
cd apps/client
npx shadcn@latest add button
```

### 設定

- コンポーネントは `apps/client/components/ui/` に配置
- `components.json` で設定を管理
- 用途により未使用エクスポートがありえるため、knip 除外方針に準拠（`knip.json` で除外設定）

## API クライアント

クライアントとサーバー間の通信は、Hono RPC (`hc<AppType>`) と `shared/lib/api.ts` で実現しています。

### 仕組み

1. **api-service**: ルート定義から `AppType` を `export type` し、`.d.ts` を生成
2. **shared/lib/api.ts**: `hc<AppType>(baseUrl)` で型付き RPC クライアントを生成

### 使用例

```typescript
// apps/client/shared/lib/api.ts
import type { AppType } from "api-service";
import { hc } from "hono/client";

export const client = hc<AppType>(baseUrl);

// apps/client/features/users/queries/get-users.ts
import { client } from "@/shared/lib/api";

export async function getUsers() {
  const res = await client.api.users.$get();
  if (res.status !== 200) throw new Error(`Failed: ${res.status}`);
  const json = await res.json();
  return json.items; // { items: User[] } に型付き
}
```

### 型安全性

- リクエスト/レスポンスの型はサーバーの Zod スキーマから自動推論（単一ソース）
- `api-service` の `build` で `.d.ts` を生成（`tsc --emitDeclarationOnly`）

## 品質チェック（推奨）

```sh
bun run lint       # Biome
bun run typecheck  # TypeScript
bun run dep:cycles # 依存循環チェック（madge）
bun run dep:orphans# 孤立依存チェック（madge）
```

## 実装方針

- サーバー呼び出しは Hono RPC (`hc<AppType>`) + `shared/lib/api.ts`経由
- サーバー専用コードは`"use client"`を付けないファイルへ配置
- shadcn系コンポーネントは用途により未使用エクスポートがありえるため、knip除外方針に準拠

詳細は [開発ガイド](../../docs/dev/development.md#client) を参照してください。
