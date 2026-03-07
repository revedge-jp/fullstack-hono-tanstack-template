# @repo/db

Prisma を使用したデータベースアクセスライブラリ。

## 概要

- **技術スタック**: Prisma, PostgreSQL
- **役割**: データベース操作の型安全なインターフェースを提供
- **共有**: Server, Worker, Scripts などから使用

## 使用方法

```typescript
import { prisma } from "@repo/db";

async function main() {
  const users = await prisma.user.findMany();
  console.log(users);
}
```

## コマンド

ルートディレクトリから以下のコマンドを実行します（`bun run db:*`）。

- `db:generate`: Prisma Client の生成（`node_modules`配下）
- `db:migrate`: 開発用マイグレーション（スキーマ変更の反映）
- `db:deploy`: 本番用マイグレーション
- `db:studio`: Prisma Studio の起動（データ閲覧・編集）

## スキーマ変更フロー

1. `packages/database/prisma/schema.prisma` を編集
2. `bun run db:migrate` を実行（マイグレーションファイルの作成と適用）
3. `bun run db:generate` を実行（クライアントの再生成）

## ディレクトリ構造

```
prisma/
├── migrations/  # マイグレーション履歴
└── schema.prisma # スキーマ定義
src/
└── index.ts     # エントリーポイント（PrismaClientのインスタンス化）
```

