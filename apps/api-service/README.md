# apps/api-service

Hono の REST API。クリーンアーキテクチャ + ROP（neverthrow の `ResultAsync` チェーン）で書く。
本番は単独でデプロイせず、client の Worker に取り込まれてインプロセスで動く
（`apps/client/shared/lib/hono-app.ts` が `createApp(env)` を呼ぶ。[ADR-001](../../docs/architecture/adr-001-cf-workers-session-check.md)）。

規約・書き方はこの README に複製しない。以下の正典を読む。

- 規約の正典: [AGENTS.md](AGENTS.md)（アーキテクチャ・依存方向・feature 構成・usecase の書き方・テスト）と
  [.claude/rules/api-service.md](../../.claude/rules/api-service.md)
- 参照実装: `src/features/tasks`
- 機能追加の入口: [機能追加ガイド](../../docs/dev/adding-features.md)
- `as` の許容範囲: [ADR-003](../../docs/architecture/adr-003-as-type-assertion-policy.md)（例外は 4 パターンのみ）
- エラーハンドリング: [ADR-005](../../docs/architecture/adr-005-neverthrow-for-error-handling.md)
- テスト: [テストガイド](../../docs/dev/testing.md)
- 各ゲートの閾値と実行タイミング: [品質ゲート ガイド](../../docs/dev/quality-gates.md)

## 単体で起動する

```sh
cd apps/api-service
bun run dev
```

`http://localhost:8080`（`API_PORT` で変更可）で Bun サーバーとして起動する。ルートの `.env` は
`dev` スクリプトの `dotenv -e ../../.env` が読み込み、`src/config.ts` が起動時に Zod で検証する。
環境変数の一覧は [環境変数ガイド](../../docs/dev/environment-variables.md)。

ブラウザでの動作確認はこのサーバーではなく、リポジトリルートの `bun run dev` で起動する
client（`http://localhost:3000`）で行う。client は 8080 を経由せず、自身のインプロセス Hono を使う。

スクリプトの一覧は `package.json` の `scripts`。

## エンドポイント

すべて `src/app.ts` の `buildApp` でマウントしている（`/api` プレフィックスもそこで付く）。

```text
GET    /api/health          DB 疎通込みのヘルスチェック（失敗・3 秒超過で 503）
GET    /api/health/live     DB 非依存の生存確認
*      /api/auth/*          Better Auth のハンドラ（GET/POST/PUT/PATCH/DELETE。レート制限あり）
GET    /api/me              セッションのユーザー（未認証は 401）
GET    /api/tasks           一覧（要認証・keyset ページネーション: cursor / limit）
POST   /api/tasks           作成（要認証）
GET    /api/tasks/:id       1 件取得（要認証）
PATCH  /api/tasks/:id       ステータスを 1 段進める（要認証。完了済みは 409）
DELETE /api/tasks/:id       削除（要認証）
GET    /api/activities      アクティビティ一覧（要認証）
POST   /api/client-errors   ブラウザのエラー通報（認証なし・レート制限あり・204）
GET    /api/dev/login       開発用サインイン（NODE_ENV=production では 404）
```

ミドルウェアの構成と順序は `src/app.ts` の `buildApp` を読む。
