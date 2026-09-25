# AGENTS.md — api-service

`apps/api-service` 固有の規約の本体。リポジトリ全体の規約（Stack・コマンド・TypeScript Style 等）は
ルートの `../../AGENTS.md` にあり、ここには複製しない。Claude Code は同じディレクトリの `CLAUDE.md`
（`@AGENTS.md` を取り込むだけ）経由で、このディレクトリのファイルを読んだときにこれを読み込む。

あわせて読むもの（Claude Code 以外のツールは自動ロードされない）:

- `../../.claude/rules/api-service.md` — ここに載っていない細部の規約
- `../../.claude/rules/logging.md` — ログを出すコードを書くとき（生の `console.*` 禁止・`error`/`err` キーの使い分け）
- `../../.claude/rules/env-vars.md` — 環境変数を足すとき

参照実装は `src/features/tasks`（CRUD + ports）。テストは `bun test <file>`、
機械的なチェックは `bun run arch:check`（ルート）。

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
│   │   ├── validators.ts          # DTO definition (XxxInput) + Zod validation (only if the action takes input to validate)
│   │   ├── steps.ts               # makeXxxStep(deps) → ResultAsync<T, E>
│   │   ├── usecase.ts             # makeXxx(deps) → okAsync().andThen() chain
│   │   └── mappers.ts             # Domain → response shape (only if the response differs from the step's output)
│   ├── service.ts                 # Aggregates use cases (injected via DI; required once a feature has 2+ actions)
│   └── index.ts                   # Re-exports each action's makeXxx (required together with service.ts)
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
実例: validators・step・mapper が揃うのは `src/features/tasks/application/list/usecase.ts`。入力検証も整形も無い
action は `okAsync(input).andThen(step)` だけになる（`get` / `delete`）。
- `usecase.ts` は `async`/`try-catch` 禁止。`okAsync().andThen()...` チェーンのみで表現する（`scripts/check/arch-guards.sh` で強制）
- リポジトリは `ResultAsync<T, E>` を返す（`Promise<Result<T, E>>` ではない）
- DB エラーは infrastructure 層で `ResultAsync.fromPromise(promise, errorMapper)` によりラップする。
  `"Unexpected"` に畳む errorMapper は `toUnexpectedDbError(logger, "<feature>.<操作>")`（`src/shared/db-error.ts`）を
  使う。`() => "Unexpected"` と書くと原因（SQLSTATE）がどのログにも残らず、DB の停止とマイグレーションの当て忘れを
  見分けられない。実例: `features/tasks/infrastructure/tasks.repository.drizzle.ts`

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
     recordTaskCreated(task: { id: string; title: string; ownerId: string }): ResultAsync<void, "Unexpected">;
   };
   ```
2. **The adapter implementing the port lives in `integrations/composition/`**, and is the only place the
   A→B connection is visible. It's built from B's `application/service.ts`:
   ```typescript
   // integrations/composition/activity-recorder.ts
   export function createActivityRecorder(deps: { activity: ActivityService }): ActivityRecorder {
     return {
       recordTaskCreated: (task) =>
         deps.activity
           .recordActivity({ ownerId: task.ownerId, kind: "task_created", message: `...` })
           .map(() => undefined)
           .mapErr(() => "Unexpected" as const), // B のエラー型を A のポートのエラー型へ正規化する
     };
   }
   ```
3. **`container.ts` wires it**: build the "provider" feature's service first, wrap it with the adapter,
   then inject into the "consumer" feature's service.

Real example: `tasks` → `activity` (`features/tasks/application/ports.ts`,
`integrations/composition/activity-recorder.ts`, wiring in `container.ts`).

**境界見直しのシグナル** — ports + adapter は増やすほど正しいわけではない。以下が出たら
feature の切り方そのものを見直す:

- 特定の feature ペア間で adapter が**双方向・複数本**になっている → 2 つの feature の境界が
  間違っている可能性が高い（統合するか、境界線を引き直す）
- **1 つの feature がほぼ全 feature から参照される** → 共有カーネル化の兆候。ports の量産では
  なく、middleware + `c.get`/`c.set` への昇格や config → container DI への昇格を検討する
- 目安: **adapter 数 > feature 数**、新 feature を追加するたびに既存の `ports.ts` を触っている、など

`integrations/` is split by role:
- `integrations/external/` — thin wrappers around third-party SDKs (e.g. `external/auth.ts` for Better Auth).
  Must not import from `features/`.
- `integrations/composition/` — feature-to-feature adapters as above. May import a feature's
  `application/service.ts` or `application/ports.ts`, but not its `domain`/`infrastructure`/`presentation`
  (`server-integrations-composition-only-application` dependency-cruiser rule).

## Testing Conventions

### Test helpers
- `createFakeApp(overrides?)` — 本物のミドルウェアスタック（`app.ts` の `buildApp`: requestId /
  requestLogger / timing / timeout / secureHeaders / CORS / bodyLimit / rate-limit / onError /
  notFound）を、DB 不要の fake 依存で組み立てたテスト用アプリを返す。DB は使わず、tasks /
  activity は **in-memory リポジトリ上の本物のサービス**、セッションはデフォルトで「認証済み」。
  返り値は Hono アプリそのものなので `app.request(...)` で直接叩けるし、`hc<AppType>` に
  `fetch: app.request.bind(app)` で注入もできる。
- Exported from `api-service/test-helpers`（`src/test-helpers/create-fake-app.ts`）
- tasks / activity の in-memory リポジトリは `src/test-helpers/in-memory-repositories.ts`。**Drizzle 実装と
  同じ振る舞いであること**を `__tests__/integration/repository-conformance.int.test.ts` が両方に同じテストを
  流して検証する（fake↔real 適合テスト）。contract テストは in-memory 上で緑になるので、ずれると本番だけ
  別の挙動になる。リポジトリのメソッドや振る舞いを変えたら、Drizzle 実装を正として in-memory を合わせ、
  適合テストにケースを足す

- 差し替えられる項目（config 相当・認証/セッション・feature のサービス・初期データ・インフラ）は
  `src/test-helpers/create-fake-app.ts` の `FakeAppOverrides` 型を見る。すべて任意で zero-config で動く

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
- `application/{op}/usecase.test.ts` (co-located) — cover each error the usecase can return
  (Invalid / NotFound / Conflict / Unexpected …), not just the happy path
- Append to `__tests__/contract/{feature}.contract.test.ts` — include the 401 case when the route requires auth
- Append to `__tests__/unit/router.validation.test.ts` (new endpoint 400s)

**api-service — only when applicable:**
- `validators.test.ts` — if `validators.ts` has non-trivial logic
- `domain/models.test.ts` — if domain has behavior (value objects)
- `__tests__/integration/{feature}.int.test.ts` — real-DB behavior (constraints, ownership scoping); wrap each test in `createTransactionalDb()` (`src/test-helpers/transactional-db.ts`) instead of hand-written cleanup
- `__tests__/integration/repository-conformance.int.test.ts` — **リポジトリを足したら必ず**: in-memory 実装を `in-memory-repositories.ts` に置き、`Harness` 型にそのリポジトリ（と時刻を明示するシード関数）を足して、`implementations` の in-memory / drizzle の両方の要素を埋める。並び順など時刻に依存する性質は、時刻を明示してシードして検証する
- `integrations/composition/{adapter}.test.ts` — **feature 間 adapter を追加したら必ず**（co-located）。
  入力の組み立てとポートのエラー型への正規化を検証する。adapter は feature 間連携の参照実装で、
  コピーされて量産される起点になるため。実例: `activity-recorder.test.ts`

## Adding a New Feature (implementation order)

1. Domain layer: models + repository interface (no external deps)
2. Infrastructure layer: Drizzle repo + mappers
3. Application layer: DTOs in `validators.ts`, steps, usecase, service
4. Presentation layer: Hono router
5. Register in `src/container.ts` and mount in `src/app.ts`
6. Run `bun run arch:check && bun run typecheck`
