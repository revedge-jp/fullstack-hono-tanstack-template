# 開発ガイド

各アプリケーション・パッケージの案内をまとめたページです。規約・構成・コード例は規約の本体（各アプリの
`AGENTS.md` と参照実装）にあり、ここには複製しません。このページに残しているのは、規約の本体に無い
背景・理由と、コマンドの補足だけです。

## 目次

- [Client](#client)
- [Server](#server)
- [DB](#db)
- [パッケージ](#パッケージ)
- [開発時のコマンド](#開発時のコマンド)
- [環境変数](#環境変数)

## Client

TanStack Start（SSR + CSR）のフロントエンド。Feature-Sliced Design ライクな構成で、api-service を
Hono RPC（`hc<AppType>`）で型付きに呼ぶ。

- 起動・ディレクトリ構成・API 呼び出し・shadcn/ui: [apps/client/README.md](../../apps/client/README.md)
- 規約の本体（データ取得の SSR / クライアント使い分け・認証・Hono RPC・テスト）: [apps/client/AGENTS.md](../../apps/client/AGENTS.md)
- 参照実装: `apps/client/features/tasks`

## Server

Hono の REST API。クリーンアーキテクチャと ROP（neverthrow）で書く。

- 概要・エンドポイント一覧・単体起動: [apps/api-service/README.md](../../apps/api-service/README.md)
- 規約の本体（依存方向・feature 構成・usecase の書き方・テスト）: [apps/api-service/AGENTS.md](../../apps/api-service/AGENTS.md)
- 参照実装: `apps/api-service/src/features/tasks`
- 機能追加・外部 SDK の置き場所: [機能追加ガイド](adding-features.md)
- `as` の許容範囲: [ADR-003](../architecture/adr-003-as-type-assertion-policy.md)（例外は 4 パターンのみ）、
  エラーハンドリング: [ADR-005](../architecture/adr-005-neverthrow-for-error-handling.md)

## DB

Drizzle ORM + PostgreSQL。スキーマ・マイグレーション・`@repo/db` の使い方は
[packages/database/README.md](../../packages/database/README.md)。

### ローカルの DB（Docker Compose）

| コマンド | 起動するもの |
|---|---|
| `bun run db:up` | `docker-compose.yml` の全サービス（開発 DB・pgAdmin・テスト DB） |
| `bun run db:up:all` | 開発 DB とテスト DB（healthcheck が通るまで待つ） |
| `bun run db:up:test` | テスト DB のみ |

- 開発 DB は `localhost:5432`、テスト DB は `localhost:5433`。どちらもユーザー `postgres` /
  パスワード `postgres` / DB 名 `app_db`（`docker-compose.yml`）。テスト DB は volume を持たない使い捨て
- `bun run db:down` は volume ごと消す（`down -v`）。main で実行すると、Claude Code の worktree が
  共有コンテナ内に持つ `wt_*` DB も消える。Claude Code の worktree（`.claude/worktrees/`）の中では
  `db:up` / `db:down` を実行しない。手動 worktree（`bun run worktree`）は使わない（[git worktree 運用ガイド](git-worktree.md)）
- pgAdmin の使い方は [pgAdmin ガイド](pgadmin.md)

## パッケージ

- **`@repo/db`**（`packages/database`）: Drizzle スキーマ/クライアントのラッパー
- **`@repo/logging`**（`packages/logging`）: pino ベースのロガー（Workers 対応）
- **`@repo/typescript-config`** / **`@repo/tailwind-config`**: 共有設定
- **`neverthrow`**（npm）: Result 型（[ADR-005](../architecture/adr-005-neverthrow-for-error-handling.md)）
- api-service と client の型共有は Hono RPC の `AppType`（`apps/api-service/src/app.ts`）で行い、共有の型パッケージは持たない

### TypeScript のバージョン方針（意図的な分離）

| 場所 | バージョン | 理由 |
|---|---|---|
| ルート `package.json` | `6.0.3`（安定版） | dependency-cruiser / knip が TypeScript の **JS コンパイラ API** を必要とする。ネイティブ版（7.x / tsgo）にすると **depcruise が 0 modules で静かに空回りする**（`bun run arch:selftest` がこれを検出する）。TS 7.1 の安定プログラマティック API と各ツールの対応を待って統一する（#26） |
| 各ワークスペース | `7.0.2`（ネイティブ tsgo） | `tsc --noEmit` の typecheck が高速。コンパイラ API は使わないため問題ない |

ツールチェーン互換問題が出た場合は、各ワークスペースの `typescript` を `6.0.3` に
揃えれば安定版に戻せる（typecheck が遅くなる以外の影響はない）。
ルートを 7.x に上げる場合は、必ず `bun run arch:selftest` が通ることを確認すること。

## 開発時のコマンド

コマンドの一覧はルートと各アプリの `package.json` の `scripts`、名前から分からない補足は
[AGENTS.md](../../AGENTS.md) の「Commands」、`check-all` / `sync-main` / `lint:fix` の詳細は
[開発コマンド詳細](dev-commands.md)、各ゲートの閾値と実行タイミングは [品質ゲート ガイド](quality-gates.md)。

### arch-guards にガードを足す

構文/配置ガード（`bun run arch:guards`）のチェックの本体は `scripts/check/arch-guards-lib.sh` の関数（`guard_xxx`）で、
`arch-guards.sh` は `ARCH_GUARDS` の順に呼ぶだけ。**ガードを足すときは、関数を足して `ARCH_GUARDS` の `guard_feature_structure` より前に並べ、
`arch-guards.selftest.sh` に既知の違反を検出するケースを `expect_guard` で1つ足す**（自己テストは
その関数だけを直接呼ぶので速い）。関数は `run_guard` 経由で、条件の中ではなく素の文として呼ぶ
（`if` や `||` の中で呼ぶと関数内の `set -e` が無効になり、途中で失敗しても止まらずに先へ進む。
ライブラリ冒頭の説明を参照）。

## 環境変数

開発環境ではルートの `.env` を使う（ルートの scripts が `dotenv -e .env` で読み込む）。
`cp .env.example .env` で作ったひな形のままで dev サーバーは起動する。変数の一覧・追加手順・本番と CI への
反映方法は [環境変数ガイド](environment-variables.md) にある。

本番（Cloudflare Workers）では `alchemy.run.ts` の Worker `bindings` で設定する。`DATABASE_URL` は手動で
登録しない — Alchemy が provision した Hyperdrive バインディングの接続文字列を、
`apps/client/shared/lib/hono-app.ts` が `env.DATABASE_URL` に載せ替える。

## 参照ドキュメント

- [環境変数ガイド](environment-variables.md) - 環境変数一覧と追加フロー
- [システムアーキテクチャ](../architecture/architecture.md) - システム全体の構成
- [開発コマンド詳細](dev-commands.md) - よく使うコマンドの詳細説明
- [apps/client/README.md](../../apps/client/README.md) - Client 詳細
- [apps/api-service/README.md](../../apps/api-service/README.md) - Server 概要
