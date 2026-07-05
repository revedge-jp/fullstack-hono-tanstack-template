# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
```

### Quality Gates (see [quality-gates.md](docs/dev/quality-gates.md) for full detail)
```bash
bun run coverage:check         # api-service domain/application coverage threshold (85%)
bun run coverage:check:client  # client actions/queries coverage threshold (80%)
cd apps/api-service && bun run mutation  # Mutation testing (domain/application, break 90%)
bun run dup:check              # Duplicate code detection (jscpd, threshold 5%)
bun run arch:selftest          # Verify arch-guards actually catch known violations
```

## Architecture: api-service

Clean Architecture with ROP (Result-Oriented Programming). Dependency direction is strictly enforced by dependency-cruiser:

```
presentation → application → domain ← infrastructure
                                     ↑
                              integrations (external APIs, etc.)
```

### Feature structure
```
src/features/{feature}/
├── domain/
│   ├── models.ts                  # Entities, value objects (pure, no external deps)
│   └── {feature}.repository.ts   # Repository interface (only if the feature owns persistence)
├── infrastructure/
│   ├── mappers.ts                 # DB ↔ Domain conversion
│   └── {feature}.repository.drizzle.ts
├── application/
│   ├── ports.ts                    # Abstract port types this feature needs from other features (optional)
│   ├── {action}/
│   │   ├── validators.ts          # DTO definition (XxxInput) + Zod validation
│   │   ├── steps.ts               # makeXxxStep(deps) → ResultAsync<T, E>
│   │   ├── usecase.ts             # makeXxx(deps) → okAsync().andThen() chain
│   │   └── mappers.ts             # Domain → response shape
│   └── service.ts                 # Aggregates use cases (injected via DI; required once a feature has 2+ actions)
└── presentation/
    ├── router.ts                  # HTTP I/O only, calls service
    └── index.ts                   # Re-exports router (barrel used by app.ts)
```
Canonical reference implementation: `tasks` (full CRUD + ports pattern). `auth` is a legitimate minimal
exception (single usecase, no owned repository — Better Auth handles its own persistence);
`scripts/check/feature-structure.mjs` accounts for this and only requires `service.ts`/`index.ts`/repository
for features that actually need them.

### Use case pattern (ROP)
```typescript
// usecase.ts
import { okAsync, type ResultAsync } from "neverthrow";

type CreateXxxError = "Conflict" | "Invalid" | "Unexpected";  // defined at top, non-exported

export function makeCreateXxx(deps: { xxxRepository: XxxRepository }) {
  const createXxxStep = makeCreateXxxStep(deps);
  return function createXxx(input: CreateXxxInput): ResultAsync<..., CreateXxxError> {
    return okAsync(input)
      .andThen(validateCreateXxx)   // sync Result-returning validator
      .andThen(createXxxStep)       // ResultAsync-returning step
      .map(toCreateXxxResponse);
  };
}
```
- `usecase.ts` は `async`/`try-catch` 禁止。`okAsync().andThen()...` チェーンのみで表現する（`scripts/check/arch-guards.sh` で強制）
- リポジトリは `ResultAsync<T, E>` を返す（`Promise<Result<T, E>>` ではない）
- DB エラーは infrastructure 層で `ResultAsync.fromPromise(promise, errorMapper)` によりラップする

### Key rules
- **Domain is pure**: no Zod, no Drizzle, no HTTP, no DTOs from Application layer
- **DTOs** (`XxxInput`) defined in Application layer (`validators.ts`), not Domain
- **`process.env` forbidden** in features and integrations; use `src/config.ts` → DI via container
- **DI**: `src/container.ts` assembles all deps; `src/app.ts` mounts routers
- **Error types** defined at top of `usecase.ts`, non-exported
- **Request-scoped logging**: the `requestLogger` middleware puts a requestId-bound pino child logger
  on the context — use `c.get("logger")` in presentation handlers instead of `console.*`. Access logs
  (method/path/status/durationMs + requestId) are emitted automatically for every request
- **認証必須ルーター**: `createAuthedApp()`（`src/factory.ts`）と `.use(requireAuth(deps.getSession))`
  （`src/middlewares/require-auth.ts`）を**必ずセットで**使う。ハンドラでは `c.get("user")` が
  non-null で型付けされる。requireAuth の付け忘れは `arch:guards` が機械的に検出する。
  実例: `features/tasks/presentation/router.ts`
  ```typescript
  export function createXxxRouter(deps: { xxx: XxxService; getSession: ReturnType<typeof makeGetSession> }) {
    return createAuthedApp()
      .use(requireAuth(deps.getSession))
      .get("/", async (c) => {
        const result = await deps.xxx.listXxx({ ownerId: c.get("user").id });
        return toHttp(c, result, { Unexpected: 500 });
      });
  }
  ```

### Feature-to-feature integration (ports + adapter + DI)

**A feature must never `import` another feature directly** (`dependency-cruiser` enforces this per-feature —
`server-application-cross-features-{feature}` rules in `dependency-cruiser.config.cjs`; the feature list is
auto-derived from the `features/` directory, so new features are covered automatically). When feature A needs
feature B's behavior:

1. **A declares the port it needs** in `features/A/application/ports.ts` — an abstract type expressing
   A's own requirement, with no knowledge of B:
   ```typescript
   // features/tasks/application/ports.ts
   export type ActivityRecorder = {
     recordTaskCreated(task: { id: string; title: string }): ResultAsync<void, "Unexpected">;
   };
   ```
2. **The adapter implementing the port lives in `integrations/composition/`**, and is the only place the
   A→B connection is visible. It's built from B's `application/service.ts`:
   ```typescript
   // integrations/composition/activity-recorder.ts
   export function createActivityRecorder(deps: { activity: ActivityService }): ActivityRecorder {
     return {
       recordTaskCreated: (task) =>
         deps.activity.recordActivity({ kind: "task_created", message: `...` }).map(() => undefined),
     };
   }
   ```
3. **`container.ts` wires it**: build the "provider" feature's service first, wrap it with the adapter,
   then inject into the "consumer" feature's service.

Real example: `tasks` → `activity` (`features/tasks/application/ports.ts`,
`integrations/composition/activity-recorder.ts`, wiring in `container.ts`).

`integrations/` is split by role:
- `integrations/external/` — thin wrappers around third-party SDKs (e.g. `external/auth.ts` for Better Auth).
  Must not import from `features/`.
- `integrations/composition/` — feature-to-feature adapters as above. May import a feature's
  `application/service.ts` or `application/ports.ts`, but not its `domain`/`infrastructure`/`presentation`
  (`server-integrations-composition-only-application` dependency-cruiser rule).

## Architecture: client

```
features/{feature}/
├── actions/    # Mutations: ブラウザから Hono RPC を直接呼ぶ平関数（POST/PATCH/DELETE）
├── queries/    # Reads: createServerFn（SSR 初回表示用）+ queryOptions（mutation 後の再取得用）
└── ui/         # React components
```

### Data fetching: SSR vs client-side

基本方針: **初回表示のデータはサーバーで取得する**。`loader` で取得したデータは SSR 時にレスポンスに含まれるため、初回表示でローディング状態が発生せず、ユーザーに即座にコンテンツを見せられる。mutation 後の再取得はブラウザからの `useQuery` invalidate で行う。

**mutation を `createServerFn` にしてはいけない**: サーバー関数化すると実行がサーバー側になり、
CF Workers では自オリジンへの HTTP ループバックが不可（ADR-001）。mutation はユーザー操作起点で
SSR 先読みが不要なので、ブラウザから同一オリジン API を直接呼ぶ（cookie は同送される）。
実例: `features/tasks/actions/create-task.ts`。

**SSR（推奨）**: `loader` でサーバーサイド取得 → `Route.useLoaderData()` で参照

```typescript
// queries/get-xxx.ts — getApiClient() は server.ts が ALS 注入した in-process Hono RPC クライアント
// （ネットワークに出ず presentation 層を通る。背景は shared/lib/api-client.ts / ADR-001）
export const getXxxServerFn = createServerFn().handler(async () => {
  const request = getRequest();
  const cookie = request.headers.get("cookie") ?? "";
  const res = await getApiClient().api.xxx.$get({}, { init: { headers: { cookie } } });
  if (!res.ok) return null;
  return res.json();
});

// app/routes/xxx.tsx
export const Route = createFileRoute("/xxx")({
  loader: async () => {
    const data = await getXxxServerFn();
    return { data };
  },
  component: XxxPage,
});

function XxxPage() {
  const { data } = Route.useLoaderData(); // SSRで取得済み、ローディング不要
}
```

**クライアントサイド**: ユーザー操作で動的に変わるデータに `useQuery`

```typescript
// queries/xxx.ts
export function xxxQueryOptions() {
  return queryOptions({
    queryKey: ["xxx"],
    retry: false,
    queryFn: async () => {
      const res = await apiClient.api.xxx.$get();
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}
```

### Auth pattern

- **認証ガード**: `_authenticated.tsx` (レイアウトルート) の `loader` で `getSessionServerFn` を呼び、未認証なら `/signin` にリダイレクト
- **ユーザー情報**: 親ルートの `loader` が `user` を返し、子ルートは `getRouteApi("/_authenticated").useLoaderData()` で参照
- **サインイン**: `authClient.signIn.social({ provider: "google" })` — クライアントサイドのみ
- **サインアウト**: `authClient.signOut()` 後に `queryClient.clear()`（前ユーザーの react-query キャッシュを破棄）してから `/signin` へ遷移

### Hono RPC

```typescript
// ブラウザ（クライアントサイド）: 相対URL
import type { AppType } from "api-service";
const apiClient = hc<AppType>("/");

// サーバーサイド（createServerFn内）: in-process クライアント + Cookie転送
// （HTTP ループバックは CF Workers で不可のため、server.ts が app.request を束ねた
//  hc クライアントを AsyncLocalStorage で注入する — shared/lib/api-client.ts / ADR-001）
import { getApiClient } from "@/shared/lib/api-client";
const res = await getApiClient().api.xxx.$get({}, {
  init: { headers: { cookie } },
});
```

## Shared Packages

| Package | Purpose |
|---|---|
| `neverthrow` (npm) | ROP: `Result`, `ResultAsync`, `ok()`, `err()`, `okAsync()`, `errAsync()` — see [ADR-005](docs/architecture/adr-005-neverthrow-for-error-handling.md) |
| `@repo/db` | Drizzle client instance + schema |
| `@repo/logging` | Pino-based logger |

## Testing Conventions

### Test helpers
- `createFakeApp(overrides?)` — 本物のミドルウェアスタック（`app.ts` の `buildApp`: requestId /
  requestLogger / timing / timeout / secureHeaders / CORS / bodyLimit / rate-limit / onError /
  notFound）を、DB 不要の fake 依存で組み立てたテスト用アプリを返す。DB は使わず、tasks /
  activity は **in-memory リポジトリ上の本物のサービス**、セッションは既定で「認証済み」。
  返り値は Hono アプリそのものなので `app.request(...)` で直接叩けるし、`hc<AppType>` に
  `fetch: app.request.bind(app)` で注入もできる。
- Exported from `api-service/test-helpers`（`src/test-helpers/create-fake-app.ts`）

`overrides`（すべて任意、zero-config で動く）:
- `nodeEnv`（既定 `"test"`）/ `corsOrigin` / `requestTimeoutMs` / `rateLimit` / `version` — config 相当。
  `onError` の本番マスキングや rate-limit / timeout の挙動を検証するときに差し替える。
- `user`（既定の認証ユーザーを差し替え）/ `getSession`（セッション解決を丸ごと差し替え。
  未認証や例外を検証するときに使う）。
- `tasks` / `activity` — feature のサービスを丸ごと差し替え（メソッド単位の Result を注入）。
- `seedTasks` / `seedActivities` — 既定の in-memory リポジトリに初期データを投入。
- `db`（health の `execute` を差し替え）/ `auth`（Better Auth ハンドラの代替）/ `logger`。

### Test patterns
```typescript
import { createFakeApp } from "api-service/test-helpers";

// zero-config: 認証済み・in-memory tasks/activity で本物のミドルウェアを通す
const app = createFakeApp();
const res = await app.request("/api/tasks");

// hono client に注入する場合
const client = hc<AppType>("http://localhost", { fetch: app.request.bind(app) });

// サービスやセッションを差し替える（コントラクトテスト等）
const app2 = createFakeApp({
  tasks: { createTask: () => errAsync("Conflict" as const), /* ... */ },
  getSession: () => errAsync("Unauthorized" as const), // 未認証を検証
});

// onError の本番マスキングを検証する
const prodApp = createFakeApp({ nodeEnv: "production", getSession: () => { throw new Error("boom"); } });

// Result type guard (neverthrow) — never `result.value` on the err side, it's `result.error`
if (result.isOk()) { /* result.value */ }
if (result.isErr()) { /* result.error */ }
```

### What tests to write (per feature addition)

**api-service — always:**
- `application/{op}/usecase.test.ts` (co-located)
- Append to `__tests__/contract/{feature}.contract.test.ts`
- Append to `__tests__/unit/router.validation.test.ts` (new endpoint 400s)

**api-service — only when applicable:**
- `validators.test.ts` — if `validators.ts` has non-trivial logic
- `domain/models.test.ts` — if domain has behavior (value objects)
- `__tests__/integration/{feature}.int.test.ts` — real-DB behavior (constraints, ownership scoping)

**client — always:**
- `actions/{action}.test.ts` (co-located)
- `queries/{query}.test.ts` (co-located)

**client — skip:** UI component tests (server component rendering tests have high cost/low value)

## TypeScript Style

- No `as` type assertions except: `as const`; `import { X as Y }`; branded-type construction in `makeXxx`/`reconstituteXxx` domain factories (immediately after validation, or for trusted DB data); casts inside `*.test.ts`. See [ADR-003](docs/architecture/adr-003-as-type-assertion-policy.md) / [ADR-004](docs/architecture/adr-004-branded-types-as-cast.md)
- No `any` — use type guards (`value is Type`) instead
- Prefer guard clauses (early return) over nesting
- Use Zod v4 API: `z.email()`, `z.url()` (not `z.string().email()`)
- Export types only when needed across files; keep file-local types non-exported

## Adding a New Feature (implementation order)

1. Domain layer: models + repository interface (no external deps)
2. Infrastructure layer: Drizzle repo + mappers
3. Application layer: DTOs in `validators.ts`, steps, usecase, service
4. Presentation layer: Hono router
5. Register in `src/container.ts` and mount in `src/app.ts`
6. Run `bun run arch:check && bun run typecheck`
