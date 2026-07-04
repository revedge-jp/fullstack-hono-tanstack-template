# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Monorepo**: Turborepo + Bun (required, no npm/yarn/pnpm)
- **Backend** (`apps/api-service`): Hono on Bun
- **Frontend** (`apps/client`): TanStack Start + React 19 + Tailwind v4
- **Database** (`packages/database`): Drizzle ORM + PostgreSQL (via `@repo/db`)
- **Auth**: Better Auth (Google OAuth) — server config in `api-service/src/integrations/external/auth.ts`
- **Testing**: `bun test` (native, no vitest/jest)
- **Linter/Formatter**: Biome
- **Quality strategy**: "generation vs verification" — see [品質ゲート ガイド](docs/dev/quality-gates.md) / [ADR-006](docs/architecture/adr-006-ai-era-quality-strategy.md)

## Commands

### Development
```bash
bun run dev           # Start all apps (Turborepo)
bun run build         # Build all
bun run typecheck     # TypeScript check across workspace
bun run lint          # Biome lint (all)
bun run lint:fix      # Biome lint + auto-fix
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
// queries/get-xxx.ts — createServerFn でSSRでもCookieを転送できる
export const getXxxServerFn = createServerFn().handler(async () => {
  const request = getRequest();
  const cookie = request.headers.get("cookie") ?? "";
  const res = await hc<AppType>(apiBaseUrl).api.xxx.$get({}, { init: { headers: { cookie } } });
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
- **サインアウト**: `authClient.signOut()` 後に `queryClient.removeQueries({ queryKey: ["auth"] })`

### Hono RPC

```typescript
// ブラウザ（クライアントサイド）: 相対URL
import type { AppType } from "api-service";
const apiClient = hc<AppType>("/");

// サーバーサイド（createServerFn内）: 絶対URL + Cookie転送
const res = await hc<AppType>(apiBaseUrl).api.xxx.$get({}, {
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
- `createFakeApp(overrides?)` — in-memory Hono app, no DB required
- Exported from `api-service/test-helpers`

### Test patterns
```typescript
// api-service: inject fake app into hono client
const app = createFakeApp();
const client = hc<AppType>("http://localhost", { fetch: app.request.bind(app) });

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
