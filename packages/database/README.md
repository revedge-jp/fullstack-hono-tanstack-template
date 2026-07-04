# @repo/db

Drizzle ORM を使用したデータベースアクセスライブラリ。

## 概要

- **技術スタック**: Drizzle ORM, postgres-js, PostgreSQL
- **役割**: データベース操作の型安全なインターフェースを提供
- **共有**: api-service（および client の Worker バンドル）から使用

## 使用方法

```typescript
import { createDb, tasks, type DbTask } from "@repo/db";

const { db, end } = createDb(databaseUrl);
const rows = await db.query.tasks.findMany();
```

## コマンド

ルートディレクトリから以下のコマンドを実行します（`bun run db:*`）。

- `db:generate`: スキーマ変更からマイグレーションファイルを生成（drizzle-kit generate）
- `db:migrate`: マイグレーションの適用（drizzle-kit migrate）
- `db:studio`: Drizzle Studio の起動（データ閲覧・編集）

## スキーマ変更フロー

1. `packages/database/src/schema/*.ts` を編集
2. `bun run db:generate` を実行（マイグレーションファイルの生成）
3. `bun run db:migrate` を実行（マイグレーションの適用）

## ディレクトリ構造

```
drizzle/          # マイグレーション履歴（Git管理）
├── *.sql
└── meta/
src/
├── index.ts      # エントリーポイント（createDb / スキーマの re-export）
└── schema/       # スキーマ定義（TypeScript）
    ├── auth.ts   # Better Auth 用テーブル
    ├── tasks.ts  # 正典 feature 用テーブル
    └── activities.ts
```
