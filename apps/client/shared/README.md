フロントの共有レイヤ。横断関心（config, api, lib, utils, styles）を配置。

## ディレクトリ方針
- `lib/`: 汎用関数・クライアント設定（例: `api.ts`）
- `utils/`: 軽量ユーティリティ
- `styles/`: 共有スタイル

## APIクライアント
- `lib/api.ts`で Hono RPC クライアント (`hc<AppType>`) を生成・エクスポート
- サーバー専用のため`import "server-only"`を付与

## knip運用
- shadcn配下コンポーネントの未使用エクスポートは除外対象
