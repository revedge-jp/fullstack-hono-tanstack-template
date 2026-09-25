# AGENTS.md

このリポジトリで作業するコーディングエージェント（Claude Code / Codex / その他 AGENTS.md 対応
ツール）向けの正典。`CLAUDE.md` はこのファイルを `@AGENTS.md` で取り込むだけの薄いラッパーで、
Claude Code 固有の補足だけを持つ。**ルールの追記はこのファイル・各アプリの `AGENTS.md`・
`.claude/rules/` のいずれかに行い、`CLAUDE.md` には書かない**。

- **アプリ固有の規約（アーキテクチャ・テスト・feature 追加手順）は各アプリの AGENTS.md にある**。
  `apps/api-service` 配下を計画・変更する前に `apps/api-service/AGENTS.md` を、`apps/client` 配下なら
  `apps/client/AGENTS.md` を読む。Claude Code は各アプリの `CLAUDE.md`（`@AGENTS.md` のみ）経由で、
  そのディレクトリのファイルを読んだ時点で自動ロードするが、ファイルを開く前の計画段階では
  読み込まれていないので、feature 追加などの設計はまず明示的に読んでから始める
- `.claude/rules/`: Claude Code は `general.md` / `package-management.md` を常時ロードし、
  `api-service.md` / `client.md` / `env-vars.md` をパススコープ（該当ファイルを読んだとき）でロードする。
  **Claude Code 以外のツールは、このファイルの次に `.claude/rules/general.md` と
  `.claude/rules/package-management.md` を読む**（ログ規約・Git 安全運用・`bun add` 必須など、最初に
  破りやすい規約はそこにある）。パススコープの 3 つは各アプリの AGENTS.md から辿る
- `REVIEW.md`: コードレビューの採否基準。Claude Code の `/code-review` と Claude Code Review が読む

## Stack

- **Monorepo**: Turborepo + Bun (required, no npm/yarn/pnpm)
- **Backend** (`apps/api-service`): Hono on Bun
- **Frontend** (`apps/client`): TanStack Start + React 19 + Tailwind v4
- **Database** (`packages/database`): Drizzle ORM + PostgreSQL (via `@repo/db`)
- **Auth**: Better Auth (Google OAuth) — server config in `api-service/src/integrations/external/auth.ts`
- **Testing**: `bun test` (native, no vitest/jest)
- **Linter/Formatter**: oxlint + oxfmt（oxc）
- **Quality strategy**: "generation vs verification" — see [品質ゲート ガイド](docs/dev/quality-gates.md) / [ADR-006](docs/architecture/adr-006-ai-era-quality-strategy.md)

## Commands

### Development
```bash
bun run dev           # Start all apps (Turborepo)
bun run build         # Build all
bun run typecheck     # TypeScript check across workspace
bun run lint          # oxlint + oxfmt --check (all)
bun run lint:fix      # oxlint --fix + oxfmt
```

### Testing
```bash
# From repo root or app directory
bun run test                        # All tests
bun run test:unit                   # Unit tests (no DB)
bun run test:integration            # Integration tests (requires DB)
bun run test:contract               # API contract tests
bun run test:watch                  # Watch mode (api-service only)

# Run a single test file
cd apps/api-service && bun test src/features/auth/application/get-session/usecase.test.ts
```

### Database
```bash
bun run db:up         # Start dev DB (Docker)
bun run db:generate   # drizzle-kit generate (create migration files)
bun run db:migrate    # drizzle-kit migrate (apply migrations)
bun run db:studio     # Drizzle Studio
```

### Architecture Checks
```bash
bun run arch:check    # All architecture/dependency checks (incl. jscpd + guard self-test)
bun run dep:cycles    # Detect circular dependencies
bun run knip          # Detect unused exports / dependencies
bun run check:feature # Feature structure completeness (required layers/tests/wiring)
bun run check:instructions # AGENTS.md / .claude/rules 等の参照(パス・bun run・見出し)が実在するか
```

### Quality Gates (see [quality-gates.md](docs/dev/quality-gates.md) for full detail)
```bash
bun run coverage:check         # api-service domain/application coverage threshold (85%)
bun run coverage:check:client  # client actions/queries coverage threshold (80%)
cd apps/api-service && bun run mutation:diff  # Mutation testing (PR diff only, same as CI; ADR-007)
cd apps/api-service && bun run mutation       # Mutation testing full audit (domain/application, break 90%)
bun run dup:check              # Duplicate code detection (jscpd, threshold 5%)
bun run arch:selftest          # Verify arch-guards actually catch known violations
```

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

## Shared Packages

| Package | Purpose |
|---|---|
| `neverthrow` (npm) | ROP: `Result`, `ResultAsync`, `ok()`, `err()`, `okAsync()`, `errAsync()` — see [ADR-005](docs/architecture/adr-005-neverthrow-for-error-handling.md) |
| `@repo/db` | Drizzle client instance + schema |
| `@repo/logging` | Pino-based logger |

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
