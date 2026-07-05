# テストガイド

新機能追加時に「どこに何のテストを書くか」の基準を定めたガイドです。
全部が毎回必須ではなく、**層ごとに判断**します。正典実装は `tasks` feature — 迷ったら
tasks の同種テストを開いてパターンを踏襲してください。

---

## 最小セット vs フル構成

```
【最小セット（シンプルな CRUD 1操作）】
api-service:
  features/{f}/application/{op}/usecase.test.ts   ← 必須
  __tests__/contract/{f}.contract.test.ts          ← 必須（追記）
  __tests__/unit/router.validation.test.ts         ← 必須（追記）

client:
  features/{f}/actions/{op}.test.ts                ← 必須
  features/{f}/queries/{q}.test.ts                 ← 必須

【追加（ロジックが増えたら）】
  domain/models.test.ts                            ← ドメイン振る舞いがある場合
  application/{op}/validators.test.ts              ← バリデータがある場合
  __tests__/integration/{f}.int.test.ts            ← 実 DB 確認が必要な場合
  tests/e2e/*.spec.ts (client)                     ← ブラウザ通しのシナリオ
```

---

## api-service チェックリスト

### 常に必要

| ファイル | 場所 | 内容 |
|---------|------|------|
| `usecase.test.ts` | `application/{op}/` co-located | 正常系×1、異常系（Invalid / NotFound / Conflict / Unexpected）×複数 |
| `contract/{f}.contract.test.ts` | `__tests__/contract/` | ステータスコードとレスポンス形状を検証（認証必須なら 401 ケースも）。既存ファイルに追記 or 新ファイル |

### ロジックがある場合のみ

| ファイル | 条件 |
|---------|------|
| `domain/models.test.ts` | ドメインオブジェクトに振る舞い（バリデーション・操作）がある場合 |
| `validators.test.ts` | `application/{op}/validators.ts` に非自明なロジックがある場合 |

### 既存ファイルに追記する（新ファイルは作らない）

| ファイル | 追記のタイミング |
|---------|---------------|
| `__tests__/unit/router.validation.test.ts` | 新エンドポイントのバリデーション（400 系） |
| `__tests__/integration/{f}.int.test.ts` | 実 DB での動作確認（制約・オーナースコープ等。`TEST_DATABASE_URL` 依存） |

---

## client チェックリスト

### 常に必要

| ファイル | 場所 | 内容 |
|---------|------|------|
| `{action}.test.ts` | `actions/` co-located | action 関数を直接呼ぶ。`mock.module` で `hono/client` を差し替え |
| `{query}.test.ts` | `queries/` co-located | serverFn を直接呼ぶ。`mock.module` で `@/shared/lib/api-client` 等を差し替え |

### 不要

- **UI コンポーネント**（`ui/` 配下）のテストは書かない
  - サーバーレンダリングの単体テストはコストに見合わない
  - データ取得は query テストが、表示は E2E（Playwright）がカバー

---

## テストヘルパーの使い方

### createFakeApp（api-service/test-helpers）

DB 接続不要のテスト用 Hono アプリを生成します。ルーターのテストでは、
service / getSession をフェイクで注入した app を組むのが基本形です
（実例: `__tests__/contract/tasks.contract.test.ts`）。

### Hono RPC クライアントの DI

```typescript
import type { AppType } from "api-service";
import { hc } from "hono/client";

const client = hc<AppType>("http://localhost", {
  fetch: app.request.bind(app),
});
```

---

## コードパターン集（すべて実在するテストの抜粋）

### api-service: usecase.test.ts（実例: `features/activity/application/record/usecase.test.ts`）

リポジトリをフェイクで注入し、Result の Ok / Err を検証します。

```typescript
import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import type { ActivityRepository } from "../../domain/activity.repository";
import { reconstituteActivity } from "../../domain/models";
import { makeRecordActivity } from "./usecase";

describe("activity.record usecase", () => {
  test("正常: 有効な入力で活動ログを記録する", async () => {
    const activityRepository: ActivityRepository = {
      record: () => okAsync(reconstituteActivity({ /* ... */ })),
      list: () => okAsync({ items: [] }),
    };
    const usecase = makeRecordActivity({ activityRepository });
    const r = await usecase({ ownerId: "user-1", kind: "task_created", message: "..." });
    expect(r.isOk()).toBe(true);
  });

  test("異常: リポジトリが失敗した場合 Unexpected を返す", async () => {
    const activityRepository: ActivityRepository = {
      record: () => errAsync("Unexpected" as const),
      list: () => okAsync({ items: [] }),
    };
    const usecase = makeRecordActivity({ activityRepository });
    const r = await usecase({ ownerId: "user-1", kind: "task_created", message: "..." });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error).toBe("Unexpected");
  });
});
```

### api-service: contract test（実例: `__tests__/contract/tasks.contract.test.ts`）

service と getSession をフェイクにしたルーターへ HTTP リクエストを投げ、
ステータス + レスポンス形状（認証 401 含む）を検証します。

```typescript
function createTestApp(overrides: MockTasks = {}) {
  const tasks = { /* 各ユースケースを okAsync/errAsync のフェイクで */ };
  return new Hono().route(
    "/api/tasks",
    createTasksRouter({ tasks, getSession: overrides.getSession ?? (() => okAsync(mockUser)) }),
  );
}

test("未認証: 401", async () => {
  const app = createTestApp({ getSession: () => errAsync("Unauthorized" as const) });
  const res = await app.request("/api/tasks");
  expect(res.status).toBe(401);
});
```

### client: action test（実例: `features/tasks/actions/create-task.test.ts`）

`mock.module` で `hono/client` を差し替え、action 関数の入出力を検証します。

```typescript
import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockOk = true;
let mockBody: unknown = { ok: false, error: "Invalid" };

mock.module("hono/client", () => ({
  hc: () => ({
    api: { tasks: { $post: mock(() => Promise.resolve({ ok: mockOk, json: async () => mockBody })) } },
  }),
}));

const { createTask } = await import("./create-task");

test("正常: API が成功を返す場合 { ok: true } を返す", async () => {
  const result = await createTask({ title: "Write docs" });
  expect(result).toEqual({ ok: true });
});
```

### client: query（serverFn）test（実例: `features/tasks/queries/get-tasks.test.ts`）

serverFn は `@tanstack/react-start` と `@/shared/lib/api-client` を `mock.module` で
差し替えてプレーン関数として呼び出します。

```typescript
mock.module("@/shared/lib/api-client", () => ({
  getApiClient: () => ({
    api: { tasks: { $get: mock(() => Promise.resolve({ ok: true, status: 200, json: async () => mockBody })) } },
  }),
}));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn) => fn }) }),
}));
```

### E2E（実例: `apps/client/tests/e2e/tasks.spec.ts`）

ログイン済み状態は DB シード + 署名済み cookie 注入で作ります（Google OAuth を経由しない。
`tests/e2e/helpers/auth.ts`）。dev / prod-shape の両モードは
`bun run test:e2e` / `bun run test:e2e -- --prod-shape` で実行します。

---

## テスト実行コマンド

```bash
# 全テスト（DB マイグレーション込み）
bun run test

# ユニットテストのみ（DB 不要）
bun run test:unit

# 統合テスト（test DB 必要: bun run db:up:test）
bun run test:integration

# E2E（dev モード / prod-shape モード）
bun run test:e2e
bun run test:e2e -- --prod-shape

# 単一ファイル（api-service）
cd apps/api-service && bun test src/features/tasks/application/create/usecase.test.ts

# 単一ファイル（client）
cd apps/client && bun test features/tasks/actions/create-task.test.ts
```
