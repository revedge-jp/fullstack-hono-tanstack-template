# AGENTS.md

このリポジトリで作業するコーディングエージェント（Claude Code / Codex / その他 AGENTS.md 対応
ツール）向けの規約本体。`CLAUDE.md` はこのファイルを `@AGENTS.md` で取り込むだけの薄いラッパーで、
Claude Code 固有の補足だけを持つ。**ルールの追記はこのファイル・各アプリの `AGENTS.md`・
`.claude/rules/` のいずれかに行い、`CLAUDE.md` には書かない**。

- **アプリ固有の規約（アーキテクチャ・テスト・feature 追加手順）は各アプリの AGENTS.md にある**。
  `apps/api-service` 配下を計画・変更する前に `apps/api-service/AGENTS.md` を、`apps/client` 配下なら
  `apps/client/AGENTS.md` を読む。Claude Code は各アプリの `CLAUDE.md`（`@AGENTS.md` のみ）経由で、
  そのディレクトリのファイルを読んだ時点で自動ロードするが、ファイルを開く前の計画段階では
  読み込まれていないので、feature 追加などの設計はまず明示的に読んでから始める
- `.claude/rules/`: Claude Code は `general.md` / `package-management.md` を常時ロードし、残り
  （`api-service.md` / `client.md` / `env-vars.md` / `logging.md` / `gemini.md` / `agent-permissions.md` /
  `worktree.md`）をパススコープ（該当ファイルを読んだとき）でロードする。
  **Claude Code 以外のツールは、このファイルの次に `.claude/rules/general.md` と
  `.claude/rules/package-management.md` を読む**（Git 安全運用・`bun add` 必須・ログ規約の要点など、最初に
  破りやすい規約はそこにある）。パススコープのルールは各アプリの AGENTS.md と `general.md` の案内から辿る
- `REVIEW.md`: コードレビューの採否基準。Claude Code の `/code-review` と Claude Code Review が読む

## Stack

- **Monorepo**: Turborepo + Bun (required, no npm/yarn/pnpm)
- **Backend** (`apps/api-service`): Hono on Bun
- **Frontend** (`apps/client`): TanStack Start + React 19 + Tailwind v4
- **Database** (`packages/database`): Drizzle ORM + PostgreSQL (via `@repo/db`)
- **Auth**: Better Auth (Google OAuth) — server config in `api-service/src/integrations/external/auth.ts`
- **Testing**: `bun test` (native, no vitest/jest)
- **Error handling**: `neverthrow`（`Result` / `ResultAsync`）で ROP — see [ADR-005](docs/architecture/adr-005-neverthrow-for-error-handling.md)
- **Linter/Formatter**: oxlint + oxfmt（oxc）
- **Quality strategy**: "generation vs verification" — see [品質ゲート ガイド](docs/dev/quality-gates.md) / [ADR-006](docs/architecture/adr-006-ai-era-quality-strategy.md)

## Commands

一覧は `package.json` の `scripts`（ルートと `apps/*`）を見る。ここには名前から分からないことだけ書く。

- `git push` の pre-push フックが `bun run check-all`（lint / typecheck / 全テスト / アーキテクチャのチェック）を実行する。
  テストは DB を使うので、DB が無いと push できない（worktree なら `.claude/rules/general.md` の worktree 節）
- 途中の確認は `bun run typecheck` と `bun run arch:check`、DB 不要のテストは `bun run test:unit`。
  1 ファイルだけなら `cd apps/api-service && bun test <file>`
- `bun run test:integration` は `.env` の `TEST_DATABASE_URL` にマイグレーションを当ててから実行する
- mutation testing は `cd apps/api-service && bun run mutation:diff`（CI と同じく PR の差分だけ。コミット済みの
  差分しか見ない）
- DB: `bun run db:up`（Docker で起動）→ スキーマを変えたら `bun run db:generate` → `bun run db:migrate`
- 各ゲートの閾値と全体像は [品質ゲート ガイド](docs/dev/quality-gates.md)
- `bun run metrics [-- --days 30]` はマージ済み PR からレビュー周回・リードタイム・マージ待ち・衝突での停止・
  レビュアー別の検出数・取りこぼしを集計する（入力は PR 本文の記録。`.claude/commands/ship.md` の「計測用の記録」）

## Debugging: ローカルトレース（Local Explorer API）

`bun run dev`（`vite dev`）と `wrangler dev` は、設定に関係なく**全リクエストの OpenTelemetry トレースと
console ログをローカルに記録**する（`@cloudflare/vite-plugin` ≥ 1.50 / wrangler ≥ 4.118）。
「なぜ 500 になったか」「どの binding 呼び出しが遅いか」は、`console.log` を仕込んで再実行する
のではなく、まずここを読む。

```bash
# 1) dev サーバーを起動し、再現するリクエストを 1 回投げる
curl -s http://localhost:3000/api/tasks -o /dev/null
# 2) スキーマ(spans / logs テーブル定義と使えるカラム)は OpenAPI の description にある
curl -s http://localhost:3000/cdn-cgi/local/explorer/api | jq '.paths["/local/observability/query"].post.description'
# 3) 読み取り専用 SQL で問い合わせる(1 文の SELECT/WITH のみ、値は params で bind)
curl -s -X POST -H 'content-type: application/json' \
  http://localhost:3000/cdn-cgi/local/explorer/api/local/observability/query \
  -d '{"sql":"SELECT * FROM spans WHERE parent_id IS NULL ORDER BY rowid DESC LIMIT 5"}'
```

- ブラウザ UI は `http://localhost:3000/cdn-cgi/local/explorer`（wrangler dev なら端末で `e`）
- 本番の自動トレースは `wrangler.jsonc` / `alchemy.run.ts` の `observability.traces.enabled` で
  有効化済み（Cloudflare ダッシュボードの Traces に出る）
- テンプレート原本の `wrangler.jsonc` は `name` が `{{APP_NAME}}` のままなので、vite-plugin の
  検証で dev サーバーが起動しない。`scripts/init-template.sh` で初期化するか、`scripts/test/test-e2e.sh`
  と同じく一時的に置換する

## Testing Conventions

- `bun test`（ネイティブ）。vitest / jest は使わない
- テストヘルパ（`createFakeApp` 等）・書くべきテストの一覧は各アプリの AGENTS.md にある:
  - `apps/api-service/AGENTS.md` の「Testing Conventions」
  - `apps/client/AGENTS.md` の「Testing Conventions」

## TypeScript Style

- No `as` type assertions except: `as const`; `import { X as Y }`; branded-type construction in `makeXxx`/`reconstituteXxx` domain factories (immediately after validation, or for trusted DB data); casts inside `*.test.ts`. See [ADR-003](docs/architecture/adr-003-as-type-assertion-policy.md) / [ADR-004](docs/architecture/adr-004-branded-types-as-cast.md)
- No `any` — use type guards (`value is Type`) instead
- Prefer guard clauses (early return) over nesting
- Use Zod v4 API: `z.email()`, `z.url()` (not `z.string().email()`)
- Export types only when needed across files; keep file-local types non-exported
