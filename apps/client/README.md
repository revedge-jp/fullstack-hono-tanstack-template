# apps/client

TanStack Start フロントエンドアプリケーション（SSR + CSR）。
本番では api-service を同一バンドルに含む単一の Cloudflare Worker としてデプロイされる。

## 起動

```sh
bun run dev
# http://localhost:3000
```

開発時も `@cloudflare/vite-plugin` 経由で workerd（Workers ランタイムの emulation）上で動く。
「Bun では動くのに client 経由だと落ちる」場合は
[トラブルシューティング - Cloudflare Workers 特有の問題](../../docs/dev/troubleshooting.md#cloudflare-workers-特有の問題) を参照。

## スタイル

- Tailwind v4（`@tailwindcss/vite`）
- UI コンポーネントは shadcn/ui ベース（`components/ui/`）

## FSD（Feature-Sliced Design）構造

```
apps/client/
├── app/                    # TanStack Start（routes / router / server entry）
│   ├── routes/             # ファイルベースルーティング（_authenticated 等）
│   └── server.ts           # Worker の fetch ハンドラー（api-service をバンドル）
├── features/               # 機能単位のスライス
│   └── tasks/              # 正典実装（参照用）
│       ├── actions/        # mutation: ブラウザから Hono RPC を直接呼ぶ平関数 + co-located test
│       ├── queries/        # データ取得（SSR loader 用）+ co-located test
│       ├── ui/             # UI コンポーネント
│       └── index.ts        # パブリック API
├── shared/                 # 共有レイヤ（横断関心）
│   └── lib/                # api-client / browser-api-client / auth-client 等
├── components/             # 汎用 UI コンポーネント
│   ├── ui/                 # shadcn/ui コンポーネント
│   ├── patterns/           # 画面パターン（PageHeader / EmptyState 等）
│   └── layout/             # ページ枠・常駐バナー
├── test-helpers/           # actions / queries テスト用のモック（api-mock.ts）
└── tests/e2e/              # Playwright
```

### レイヤー規則

- **features**: 機能単位のスライス。`actions`、`queries`、`ui` に分割
- **shared**: 横断関心（`shared/lib/` の API クライアント・認証クライアント・ロガー等）を配置
- **components**: 汎用的な UI コンポーネント（shadcn/ui・画面パターン・レイアウト）

### 依存関係ルール

- `shared` から `features` への参照は禁止
- `features` 間の直接参照は禁止

## API 呼び出し

- **ブラウザ（CSR）**: `shared/lib/browser-api-client.ts` の共有インスタンス `browserApiClient`（相対 URL の
  Hono RPC クライアント）→ 同一 Worker の `/api/*`。`hc<AppType>("/")` を各ファイルで作らない
- **SSR（loader / createServerFn）**: CF Workers では同一オリジンへの `fetch()` がループバックしない
  （[ADR-001](../../docs/architecture/adr-001-cf-workers-session-check.md)）ため、
  `shared/lib/api-client.ts` が AsyncLocalStorage 経由で注入するインプロセス Hono RPC クライアントで呼ぶ。
  実例: `features/tasks/queries/get-tasks.ts`
- 型はサーバーの `AppType` から推論（`api-service` の `build` で `.d.ts` 生成）

## shadcn/ui

```bash
cd apps/client
bunx shadcn@latest add button
```

- コンポーネントは `components/ui/` に配置、`components.json` で設定管理
- 未使用エクスポートがありえるため knip 除外方針に準拠（`knip.json`）

## 品質チェック

```sh
bun run lint       # oxlint + oxfmt --check
bun run typecheck  # TypeScript
bun run test:unit  # app / features / shared の co-located テスト
bun run dep:cycles # 依存循環チェック（madge）
```

詳細は [開発ガイド](../../docs/dev/development.md#client) と [AGENTS.md](AGENTS.md#architecture-client) を参照してください。
