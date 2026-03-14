# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Monorepo**: Turborepo + Bun (required, no npm/yarn/pnpm)
- **Backend** (`apps/api-service`): Hono on Bun
- **Frontend** (`apps/client`): TanStack Start + React 19 + Tailwind v4
- **Database** (`packages/database`): Drizzle ORM + PostgreSQL (via `@repo/db`)
- **Auth**: Better Auth (Google OAuth) — server config in `api-service/src/integrations/auth.ts`
- **Testing**: `bun test` (native, no vitest/jest)
- **Linter/Formatter**: Biome

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
bun run arch:check    # All architecture/dependency checks
bun run dep:cycles    # Detect circular dependencies
bun run knip          # Detect unused exports / dependencies
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
│   └── {feature}.repository.ts   # Repository interface
├── infrastructure/
│   ├── mappers.ts                 # DB ↔ Domain conversion
│   └── {feature}.repository.drizzle.ts
├── application/
│   ├── {action}/
│   │   ├── validators.ts          # DTO definition (XxxInput) + Zod validation
│   │   ├── steps.ts               # makeXxxStep(deps) → Result<T, E>
│   │   ├── usecase.ts             # makeXxx(deps) → flow chain
│   │   └── mappers.ts             # Domain → response shape
│   └── service.ts                 # Aggregates use cases (injected via DI)
└── presentation/
    └── router.ts                  # HTTP I/O only, calls service
```

### Use case pattern (ROP)
```typescript
// usecase.ts
type CreateXxxError = "Conflict" | "Invalid" | "Unexpected";  // defined at top, non-exported

export function makeCreateXxx(deps: { xxxRepository: XxxRepository }) {
  const createXxxStep = makeCreateXxxStep(deps);
  return async function createXxx(input: CreateXxxInput): Promise<Result<..., CreateXxxError>> {
    return flow<CreateXxxInput>(input)
      .andThen(validateCreateXxx)
      .asyncAndThen(createXxxStep)
      .map(toCreateXxxResponse)
      .value();
  };
}
```

### Key rules
- **Domain is pure**: no Zod, no Drizzle, no HTTP, no DTOs from Application layer
- **DTOs** (`XxxInput`) defined in Application layer (`validators.ts`), not Domain
- **`process.env` forbidden** in features and integrations; use `src/config.ts` → DI via container
- **DI**: `src/container.ts` assembles all deps; `src/app.ts` mounts routers
- **Error types** defined at top of `usecase.ts`, non-exported

## Architecture: client

```
features/{feature}/
├── actions/    # Mutations: createServerFn (POST/PUT/DELETE), invalidate queries
├── queries/    # Reads: queryOptions (TanStack Query) + createServerFn for SSR reads
└── ui/         # React components
```

### Data fetching: SSR vs client-side

基本方針: **データはサーバーで取得する**。`loader` で取得したデータは SSR 時にレスポンスに含まれるため、初回表示でローディング状態が発生せず、ユーザーに即座にコンテンツを見せられる。クライアントサイドフェッチはユーザー操作に応じて動的に変わるデータに限定する。

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
| `@repo/result` | ROP: `Ok`, `Err`, `Result`, `ok()`, `err()`, `flow()`, `all()`, `tryCatch()` |
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

// Result type guard
if (result.type === "ok") { /* result.value */ }
if (result.type === "err") { /* result.value */ }
```

### What tests to write (per feature addition)

**api-service — always:**
- `application/{op}/usecase.test.ts` (co-located)
- Append to `__tests__/contract/{feature}.contract.test.ts`
- Append to `__tests__/unit/router.validation.test.ts` (new endpoint 400s)

**api-service — only when applicable:**
- `validators.test.ts` — if `validators.ts` has non-trivial logic
- `domain/models.test.ts` — if domain has behavior (value objects)
- Append to `__tests__/scenario/{feature}.scenario.test.ts` — multi-step flows

**client — always:**
- `actions/{action}.test.ts` (co-located)
- `queries/{query}.test.ts` (co-located)

**client — skip:** UI component tests (server component rendering tests have high cost/low value)

## TypeScript Style

- No `as` type assertions (except `as const`, `as unknown` in tests, `as never` in type-only files)
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
