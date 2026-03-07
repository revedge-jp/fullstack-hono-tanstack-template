# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Monorepo**: Turborepo + Bun (required, no npm/yarn/pnpm)
- **Backend** (`apps/api-service`): Hono on Bun
- **Frontend** (`apps/client`): Next.js 16 + React 19 + Tailwind v4
- **Database** (`packages/database`): Prisma 7 + PostgreSQL (via `@repo/db`)
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
cd apps/api-service && bun test src/features/users/application/create/usecase.test.ts
cd apps/client && bun test features/users/actions/create.test.ts
```

### Database
```bash
bun run db:up         # Start dev DB (Docker)
bun run db:migrate    # Prisma migrate dev
bun run db:seed       # Seed data
bun run db:studio     # Prisma Studio
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
                              integrations (external APIs, Cloud Tasks, etc.)
```

### Feature structure
```
src/features/{feature}/
├── domain/
│   ├── models.ts                  # Entities, value objects (pure, no external deps)
│   └── {feature}.repository.ts   # Repository interface
├── infrastructure/
│   ├── mappers.ts                 # DB ↔ Domain conversion
│   └── {feature}.repository.prisma.ts
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
type CreateUserError = "Conflict" | "Invalid" | "Unexpected";  // defined at top, non-exported

export function makeCreateUser(deps: { usersRepository: UsersRepository }) {
  const createUserStep = makeCreateUserStep(deps);
  return async function createUser(input: CreateUserInput): Promise<Result<..., CreateUserError>> {
    return flow<CreateUserInput>(input)
      .andThen(validateCreateUser)
      .asyncAndThen(createUserStep)
      .map(toCreateUserResponse)
      .value();
  };
}
```

### Key rules
- **Domain is pure**: no Zod, no Prisma, no HTTP, no DTOs from Application layer
- **DTOs** (`XxxInput`) defined in Application layer (`validators.ts`), not Domain
- **`process.env` forbidden** in features; use `src/config.ts` → DI via container
- **DI**: `src/container.ts` assembles all deps; `src/app.ts` mounts routers
- **Error types** defined at top of `usecase.ts`, non-exported

## Architecture: client

```
features/{feature}/
├── actions/    # Next.js Server Actions (mutations, call apiClient, revalidate tags)
├── queries/    # Data fetching (Next.js cache with tags)
└── ui/         # React components (RSC and client components)
```

Type-safe API calls via Hono RPC:
```typescript
import type { AppType } from "api-service";
const client = hc<AppType>(baseUrl);
// Usage: client.api.users.$get(), client.api.users.$post()
```

### Server Action pattern (`processXxx` / `xxxAction`)
```typescript
// actions/create.ts
export async function processCreateUser(formData: FormData, client: ApiClient = apiClient) {
  // pure function: testable by injecting a mock client
}

export async function createUserAction(formData: FormData) {
  "use server";
  return processCreateUser(formData);
}
```
- `processXxx` — pure function, DI-friendly, called in tests
- `xxxAction` — thin wrapper with `"use server"`, called from UI
- UI components import `xxxAction`, never `processXxx` directly

## Shared Packages

| Package | Purpose |
|---|---|
| `@repo/result` | ROP: `Ok`, `Err`, `Result`, `ok()`, `err()`, `flow()`, `all()`, `tryCatch()` |
| `@repo/db` | Prisma client instance |
| `@repo/logging` | Pino-based logger |

## Testing Conventions

### Test helpers
- `createFakeApp(overrides?)` — in-memory Hono app, no DB required
- `createInMemoryUsersRepository()` — in-memory repo for unit tests
- Both exported from `api-service/test-helpers`

### Test patterns
```typescript
// api-service: inject fake app into hono client
const app = createFakeApp();
const client = hc<AppType>("http://localhost", { fetch: app.request.bind(app) });

// client actions: prevent real API calls
mock.module("next/cache", () => ({ updateTag: mock() }));
mock.module("@/shared/lib/api", () => ({ apiClient: null }));

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
- Append to `test-helpers/users.inmemory.repository.test.ts` — new repo methods

**client — always:**
- `actions/{action}.test.ts` (co-located)
- `queries/{query}.test.ts` (co-located)

**client — skip:** UI component tests (RSC rendering tests have high cost/low value)

## TypeScript Style

- No `as` type assertions (except `as const`, `as unknown` in tests, `as never` in type-only files)
- No `any` — use type guards (`value is Type`) instead
- Prefer guard clauses (early return) over nesting
- Use Zod v4 API: `z.email()`, `z.url()` (not `z.string().email()`)
- Export types only when needed across files; keep file-local types non-exported

## Adding a New Feature (implementation order)

1. Domain layer: models + repository interface (no external deps)
2. Infrastructure layer: Prisma repo + mappers
3. Application layer: DTOs in `validators.ts`, steps, usecase, service
4. Presentation layer: Hono router
5. Register in `src/container.ts` and mount in `src/app.ts`
6. Run `bun run arch:check && bun run typecheck`
