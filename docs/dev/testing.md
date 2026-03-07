# テストガイド

新機能追加時に「どこに何のテストを書くか」の基準を定めたガイドです。
全部が毎回必須ではなく、**層ごとに判断**します。

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
  __tests__/scenario/{f}.scenario.test.ts          ← 複数ステップシナリオがある場合
  __tests__/integration/app.int.test.ts            ← 実 DB 確認が必要な場合
```

---

## api-service チェックリスト

### 常に必要

| ファイル | 場所 | 内容 |
|---------|------|------|
| `usecase.test.ts` | `application/{op}/` co-located | 正常系×1、異常系（Invalid / NotFound / Conflict / Unexpected）×複数 |
| `contract/{f}.contract.test.ts` | `__tests__/contract/` | レスポンスの**スキーマ形状**を Zod で検証。既存ファイルに追記 or 新ファイル |
| `inmemory.repository.test.ts` | `test-helpers/` | repo に新メソッドを追加した場合は追記 |

### ロジックがある場合のみ

| ファイル | 条件 |
|---------|------|
| `domain/models.test.ts` | ドメインオブジェクトに振る舞い（バリデーション・操作）がある場合 |
| `validators.test.ts` | `application/{op}/validators.ts` を作った場合 |

### 既存ファイルに追記する（新ファイルは作らない）

| ファイル | 追記のタイミング |
|---------|---------------|
| `__tests__/unit/router.validation.test.ts` | 新エンドポイントのバリデーション（400 系） |
| `__tests__/scenario/{f}.scenario.test.ts` | 複数ステップにまたがるフロー（create → update → get など） |
| `__tests__/integration/app.int.test.ts` | 実 DB での動作確認が必要な場合（`TEST_DATABASE_URL` 依存） |

---

## client チェックリスト

### 常に必要

| ファイル | 場所 | 内容 |
|---------|------|------|
| `{action}.test.ts` | `actions/` co-located | `process{Op}` を直接呼ぶ。`createFakeApp` + `hc` で DI |
| `{query}.test.ts` | `queries/` co-located | query 関数を直接呼ぶ。同上 |

### 不要

- **UI コンポーネント**（`ui/` 配下）のテストは書かない
  - RSC のレンダリング単体テストはコストに見合わない
  - データ取得は query テストが、表示は E2E（Playwright）がカバー

---

## テストヘルパーの使い方

### createFakeApp

DB 接続不要のテスト用 Hono アプリを生成します。
api-service・client のどちらのテストでも共通で使います。

```typescript
import { createFakeApp, createInMemoryUsersRepository, reconstituteUser } from "api-service/test-helpers";

// 空の状態で起動
const app = createFakeApp();

// 初期データを注入
const repo = createInMemoryUsersRepository([
  reconstituteUser({ id: "550e8400-...", email: "alice@example.com", name: "Alice" }),
]);
const app = createFakeApp({ usersRepository: repo });
```

### Hono RPC クライアントの DI

```typescript
import type { AppType } from "api-service";
import { hc } from "hono/client";

const client = hc<AppType>("http://localhost", {
  fetch: app.request.bind(app),
});
```

---

## コードパターン集

### api-service: usecase.test.ts

```typescript
import { describe, expect, test } from "bun:test";
import { err, ok } from "@repo/result";
import { reconstituteUser, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeCreateUser } from "./usecase";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";

describe("users.create ユースケース", () => {
  test("正常: 有効な入力でユーザーを作成する", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => ok(reconstituteUser({ id: ID_1, email: "test@example.com", name: "Test" })),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({ email: "test@example.com", name: "Test User" });
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.item.id).toBe(ID_1);
    }
  });

  test("異常: バリデーション失敗で Invalid を返す", async () => {
    const usersRepository: UsersRepository = { /* ... */ } as UsersRepository;
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({ email: "invalid-email", name: "User" });
    expect(r.type).toBe("err");
    if (r.type === "err") expect(r.value).toBe("Invalid");
  });

  test("異常: メール重複で Conflict を返す", async () => {
    const usersRepository: UsersRepository = {
      // ...
      create: async () => err("Conflict"),
    } as UsersRepository;
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({ email: "dup@example.com", name: "User" });
    expect(r.type).toBe("err");
    if (r.type === "err") expect(r.value).toBe("Conflict");
  });
});
```

### api-service: contract test への追記

```typescript
// __tests__/contract/users.contract.test.ts に追記
test("DELETE /api/users/:id → 204 を返す", async () => {
  const app = createFakeApp();
  // まず create して id を取得
  const createRes = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "del@example.com", name: "Del" }),
  });
  const { item } = (await createRes.json()) as { item: { id: string } };

  const res = await app.request(`/api/users/${item.id}`, { method: "DELETE" });
  expect(res.status).toBe(204);
});
```

### api-service: router.validation.test.ts への追記

```typescript
// __tests__/unit/router.validation.test.ts に追記
test("DELETE /users/:id: 不正な UUID で 400 または 404 を返す", async () => {
  const app = createFakeApp();
  const res = await app.request("/api/users/not-a-uuid", { method: "DELETE" });
  expect([400, 404]).toContain(res.status);
});
```

### client: action.test.ts

```typescript
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppType } from "api-service";
import { createFakeApp, type createInMemoryUsersRepository } from "api-service/test-helpers";
import { hc } from "hono/client";
import { processCreateUser } from "./create";

mock.module("next/cache", () => ({ updateTag: mock() }));
mock.module("@/shared/lib/api", () => ({ apiClient: null }));

function makeFakeApiClient(repo?: ReturnType<typeof createInMemoryUsersRepository>) {
  const app = createFakeApp(repo ? { usersRepository: repo } : {});
  return hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
}

describe("processCreateUser", () => {
  let client: ReturnType<typeof makeFakeApiClient>;

  beforeEach(() => {
    client = makeFakeApiClient();
  });

  test("正常: 有効な入力でユーザーを作成する", async () => {
    const fd = new FormData();
    fd.append("email", "alice@example.com");
    fd.append("name", "Alice");
    const result = await processCreateUser(fd, client);
    expect(result.ok).toBe(true);
  });

  test("異常: 不正なメールアドレスはバリデーションエラーを返す", async () => {
    const fd = new FormData();
    fd.append("email", "not-an-email");
    fd.append("name", "Alice");
    const result = await processCreateUser(fd, client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
```

### client: query.test.ts

```typescript
import { describe, expect, test } from "bun:test";
import type { AppType } from "api-service";
import { createFakeApp, createInMemoryUsersRepository, reconstituteUser } from "api-service/test-helpers";
import { hc } from "hono/client";
import { getUsers } from "./get-users";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";

function makeFakeApiClient(repo?: ReturnType<typeof createInMemoryUsersRepository>) {
  const app = createFakeApp(repo ? { usersRepository: repo } : {});
  return hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
}

describe("getUsers", () => {
  test("正常: フェイクアプリからユーザー一覧を返す", async () => {
    const repo = createInMemoryUsersRepository([
      reconstituteUser({ id: ID_1, email: "alice@example.com", name: "Alice" }),
    ]);
    const users = await getUsers({ apiClient: makeFakeApiClient(repo) });
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("alice@example.com");
  });

  test("正常: ユーザーが存在しない場合は空配列を返す", async () => {
    const users = await getUsers({ apiClient: makeFakeApiClient() });
    expect(users).toHaveLength(0);
  });
});
```

---

## テスト実行コマンド

```bash
# 全テスト（DB マイグレーション込み）
bun run test

# ユニットテストのみ（DB 不要）
bun run test:unit

# 単一ファイル（api-service）
cd apps/api-service && bun test src/features/users/application/create/usecase.test.ts

# 単一ファイル（client）
cd apps/client && bun test features/users/actions/create.test.ts
```
