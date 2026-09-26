---
paths:
  - ".env.example"
  - "**/config.ts"
  - "turbo.json"
  - "alchemy.run.ts"
  - ".github/workflows/**"
  - "docker-compose.yml"
---

# 環境変数の追加・変更チェックリスト

手順の本体は `docs/dev/environment-variables.md`。追加・変更時は必ず同ドキュメントのフローに従い、以下をすべて更新する。

## 設計原則

- アプリケーションコード（テスト・`alchemy.run.ts`・ツールの設定ファイルを除く）で `process.env` を読んでよいのは
  api-service の `src/config.ts` だけ。api-service は `loadConfig()` → container DI で受け取り、`integrations/` 層も
  呼び出し元からパラメータで受け取る。client は独自の設定機構を持たない（下の「client / Docker のみの場合」）。
- 検証: api-service は `scripts/check/api-process-env.sh`（`src/` 全体。`bun run arch:check` と `bun run check-all` が呼ぶ）、
  client は `bun run arch:guards` の `guard_client_features_no_process_env`（`apps/client/` の app/・features/・shared/・components/）が検出する。
  `node:process` / `process` / `cloudflare:workers` の default・namespace の import（`import nodeProcess from "node:process"`）は
  env を使わなくても止まる。`process.exit` 等はグローバルの `process` を使う。

## api-service に追加する場合

1. `.env.example` にサンプル値とコメントを追加
2. `apps/api-service/src/config.ts`: `ConfigSchema` / `AppConfig` / `loadConfig()` の 3 箇所を更新
3. build / dev / test で使う場合は `turbo.json` の該当タスクの `env` に追加（キャッシュキーに影響）
4. CI で必要なら `.github/workflows/ci.yml` の該当ジョブの `env` に追加
5. 本番反映: `alchemy.run.ts` の Worker `bindings` に追加（非機密は文字列、機密は `alchemy.secret(requireEnv(...))`。`docs/dev/environment-variables.md` の「本番環境への反映」参照）。値は `.github/workflows/deploy.yml` が GitHub Environments から渡す
6. `docs/dev/environment-variables.md` の一覧を更新

## client / Docker のみの場合

- client には独自の設定機構が無い。SSR / `createServerFn` は同一 Worker 内の api-service が
  `loadConfig(env)` で読んだ値を使うので、**client 側で `process.env` を読まず**、必要な値は
  api-service の `config.ts` に足して loader / serverFn 経由で受け取る
- ブラウザに出す値を build 時定数にするときだけ `VITE_` 接頭辞（現状は `import.meta.env.DEV` のみ使用）。
  バンドルに埋め込まれるので機密は絶対に含めない。実行環境ごとに変わる値は `VITE_` ではなく
  route の loader（サーバー側）から返す
- Docker: `docker-compose.yml` ではコンテナ名・ポート・ボリューム名等を `${VAR:-default}` 形式で上書き可能にし、`.env.example` に例を載せる

## 完了時チェック

- [ ] `.env.example` を更新したか
- [ ] `config.ts`（ConfigSchema / AppConfig / loadConfig）を更新したか
- [ ] `turbo.json` の `env` に追加したか（該当タスクで使う場合）
- [ ] CI / デプロイの workflow を更新したか（必要な場合）
- [ ] `alchemy.run.ts` の `bindings`（と deploy.yml の env）を更新したか（本番で使う場合）
- [ ] `docs/dev/environment-variables.md` を更新したか
- [ ] `bun run arch:check` が通るか
