# api-service 機能追加の手順

新しい機能（例: `posts`）を追加する際の手順を以下に示します。クリーンアーキテクチャの層構造に従って、下位層から順に実装します。

## 1. ディレクトリ構造の作成

機能のディレクトリ構造を作成します:

```
src/features/posts/
  ├── domain/
  │   └── posts.repository.ts          # リポジトリインターフェース
  ├── infrastructure/
  │   ├── mappers.ts                   # DB ↔ Domain マッパー
  │   └── posts.repository.drizzle.ts  # リポジトリ実装
  ├── application/
  │   ├── create/
  │   │   ├── steps.ts                # ステップ関数
  │   │   ├── validators.ts            # 入力検証
  │   │   └── usecase.ts               # ユースケース
  │   ├── list/
  │   │   ├── steps.ts
  │   │   └── usecase.ts
  │   ├── index.ts                     # ユースケースのエクスポート
  │   ├── ports.ts                     # ポート定義（必要に応じて）
  │   └── service.ts                   # サービスファクトリ
  └── presentation/
      ├── index.ts                     # ルーターのエクスポート
      └── router.ts                    # HTTP I/O とバリデーション
```

## 2. Domain層の実装

### 2.1. ドメインモデルとリポジトリインターフェース

`src/features/posts/domain/posts.repository.ts`:

```typescript
import { err, ok, type Result, type ResultAsync } from "neverthrow";

export type Post = {
  id: number;
  title: string;
  content: string;
  authorId: number;
  createdAt: Date;
};

// ドメイン不変条件のバリデーション関数
// Domain層はDTOを知らないため、プリミティブな値を受け取る
export function isValidPostTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= 1 && trimmed.length <= 200;
}

/**
 * 投稿作成時のドメイン不変条件を検証する
 */
export function validatePostInvariants(
  title: string,
  content: string
): Result<null, "Invalid"> {
  if (!isValidPostTitle(title)) {
    return err("Invalid" as const);
  }
  // 他のドメイン不変条件（contentの長さチェックなど）があればここに追加
  return ok(null);
}

// リポジトリインターフェース（抽象）。ResultAsync<T, E> を返す（Promise<Result<T, E>> ではない）
export type PostsRepository = {
  list(): ResultAsync<{ items: Post[] }, "Unexpected">;
  create(input: {
    title: string;
    content: string;
    authorId: number;
  }): ResultAsync<Post, "Conflict" | "Unexpected">;
  getById(id: number): ResultAsync<Post | null, "Unexpected">;
};
```

**注意事項**:
- Domain層は外部ライブラリ（Zod、Drizzle、HTTP等）に依存しない
- ドメイン不変条件のバリデーション関数は純粋関数として実装
- **DTO型（`CreatePostInput`など）はDomain層には置かない**

## 3. Infrastructure層の実装

### 3.1. マッパー

`src/features/posts/infrastructure/mappers.ts`:

```typescript
import type { Post } from "../domain/posts.repository";
import type { Post as DbPost } from "@repo/db";

export function mapDbPostToDomain(dbPost: DbPost): Post {
  return {
    id: dbPost.id,
    title: dbPost.title,
    content: dbPost.content,
    authorId: dbPost.authorId,
    createdAt: dbPost.createdAt,
  };
}
```

### 3.2. リポジトリ実装

`src/features/posts/infrastructure/posts.repository.drizzle.ts`:

```typescript
import type { Database } from "@repo/db";
import { ResultAsync } from "neverthrow";
import { isPgError } from "@app/shared/db-error";
import type { PostsRepository, Post } from "../domain/posts.repository";
import { mapDbPostToDomain } from "./mappers";

export function createPostsRepository(deps: { db: Database }): PostsRepository {
  const { db } = deps;

  return {
    list: () =>
      ResultAsync.fromPromise(
        db.query.posts.findMany({ orderBy: (p, { desc }) => desc(p.id) }),
        () => "Unexpected" as const,
      ).map((rows) => ({ items: rows.map(mapDbPostToDomain) })),

    create: (input: { title: string; content: string; authorId: number }) =>
      ResultAsync.fromPromise(
        db.insert(posts).values(input).returning().then((rows) => rows[0]),
        (e) => (isPgError(e, "23505") ? ("Conflict" as const) : ("Unexpected" as const)),
      ).map(mapDbPostToDomain),

    getById: (id: number) =>
      ResultAsync.fromPromise(
        db.query.posts.findFirst({ where: (p, { eq }) => eq(p.id, id) }),
        () => "Unexpected" as const,
      ).map((row) => (row ? mapDbPostToDomain(row) : null)),
  };
}
```

`db.insert` の一意制約違反（PostgreSQL エラーコード `23505`）を `isPgError` で検出して `"Conflict"` にマッピングしている。

## 4. Application層の実装

### 4.1. バリデーション

**ユースケースの入出力（DTO）は Application 層で定義します。**
Application層のバリデータは、1) 契約スキーマのチェック と 2) ドメイン不変条件のチェック（Domain層へ委譲）を行います。

`src/features/posts/application/create/validators.ts`:

```typescript
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { validatePostInvariants } from "../../domain/posts.repository"; // Domainバリデーション

const CreatePostRequestSchema = z.object({ title: z.string(), content: z.string(), authorId: z.number() });

// ユースケースの入力型 (DTO)
export type CreatePostInput = { title: string; content: string; authorId: number };

/**
 * 投稿作成入力をバリデーションする
 */
export function validateCreatePost(
  input: CreatePostInput
): Result<CreatePostInput, "Invalid"> {
  // 1. 契約スキーマで形式チェック (Zod)
  const parsed = CreatePostRequestSchema.safeParse(input);
  if (!parsed.success) {
    return err("Invalid" as const);
  }

  // 2. ドメイン不変条件をチェック (Domain層へ委譲)
  // DTOを分解して、プリミティブな値をDomain関数に渡す
  const domainResult = validatePostInvariants(input.title, input.content);
  if (domainResult.isErr()) {
    return err("Invalid" as const);
  }

  return ok(input);
}
```

**注意事項**:
- `CreatePostInput` (DTO) はここで定義する
- Domain層の関数呼び出し時は、DTOをそのまま渡さず、必要な値だけを渡す（Domain層をDTOから独立させるため）

### 4.2. ステップ関数

`src/features/posts/application/create/steps.ts`:

```typescript
import type { ResultAsync } from "neverthrow";
import type { PostsRepository } from "../../domain/posts.repository";
import type { CreatePostInput } from "./validators";

// 入出力型（ファイルローカル）
type CreatePostStepInput = CreatePostInput;
type CreatePostStepOutput = ResultAsync<{ item: { id: number } }, "Conflict" | "Unexpected">;

export function makeCreatePostStep(deps: { postsRepository: PostsRepository }) {
  const { postsRepository } = deps;
  return function createPostStep(i: CreatePostStepInput): CreatePostStepOutput {
    return postsRepository.create(i).map((created) => ({ item: { id: created.id } }));
  };
}
```

### 4.3. ユースケース

`src/features/posts/application/create/usecase.ts`:

```typescript
import type { PostsRepository } from "../../domain/posts.repository";
import { okAsync, type ResultAsync } from "neverthrow";
import { makeCreatePostStep } from "./steps";
import { type CreatePostInput, validateCreatePost } from "./validators";

type CreatePostError = "Conflict" | "Invalid" | "Unexpected";

export function makeCreatePost(deps: { postsRepository: PostsRepository }) {
  const createPostStep = makeCreatePostStep(deps);
  return function createPost(
    input: CreatePostInput
  ): ResultAsync<{ item: { id: number } }, CreatePostError> {
    return okAsync(input).andThen(validateCreatePost).andThen(createPostStep);
  };
}
```

### 4.4. リストユースケース（例）

`src/features/posts/application/list/steps.ts`:

```typescript
import type { ResultAsync } from "neverthrow";
import type { Post, PostsRepository } from "../../domain/posts.repository";

type FetchPostsStepOutput = ResultAsync<{ items: Post[] }, "Unexpected">;

export function makeFetchPostsStep(deps: { postsRepository: PostsRepository }) {
  const { postsRepository } = deps;
  return function fetchPostsStep(): FetchPostsStepOutput {
    return postsRepository.list();
  };
}
```

`src/features/posts/application/list/usecase.ts`:

```typescript
import type { Post, PostsRepository } from "../../domain/posts.repository";
import { okAsync, type ResultAsync } from "neverthrow";
import { makeFetchPostsStep } from "./steps";

type ListPostsError = "Unexpected";

export function makeListPosts(deps: { postsRepository: PostsRepository }) {
  const fetchPostsStep = makeFetchPostsStep(deps);
  return function listPosts(): ResultAsync<{ items: Post[] }, ListPostsError> {
    return okAsync(undefined).andThen(fetchPostsStep);
  };
}
```

### 4.5. ユースケースのエクスポート

`src/features/posts/application/index.ts`:

```typescript
export { makeCreatePost } from "./create/usecase";
export { makeListPosts } from "./list/usecase";
```

### 4.6. サービスファクトリ

`src/features/posts/application/service.ts`:

```typescript
import type { PostsRepository } from "../domain/posts.repository";
import { makeCreatePost, makeListPosts } from "./index";

export type PostsService = ReturnType<typeof createPostsService>;

export function createPostsService(deps: { postsRepository: PostsRepository }) {
  const { postsRepository } = deps;

  const listPosts = makeListPosts({ postsRepository });
  const createPost = makeCreatePost({ postsRepository });

  return { listPosts, createPost };
}
```

## 5. Contractsの追加（HTTP API定義）

`packages/contracts/src/http/posts.ts`を追加:

```typescript
import { z } from "zod";

export const CreatePostRequestSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  authorId: z.number().int().positive(),
});

export type CreatePostRequest = z.infer<typeof CreatePostRequestSchema>;

export const PostsListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  content: z.string(),
  authorId: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const PostsListResponseSchema = z.object({
  items: z.array(PostsListItemSchema),
});

export type PostsListResponse = z.infer<typeof PostsListResponseSchema>;
```

`packages/contracts/src/index.ts`にエクスポートを追加:

```typescript
export * from "./http/posts";
```

## 6. Presentation層の実装

`src/features/posts/presentation/router.ts`:

```typescript
import type { PostsService } from "@features/posts/application/service";
import { toHttp } from "@app/shared/http/to-http";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const CreatePostRequestSchema = z.object({
  title: z.string(),
  content: z.string(),
  authorId: z.number(),
});

export function createPostsRouter(cntr: { posts: PostsService }) {
  const app = new Hono()
    .get("/", async (c) => {
      const result = await cntr.posts.listPosts();
      return toHttp(c, result, { Unexpected: 500 });
    })
    .post("/", zValidator("json", CreatePostRequestSchema), async (c) => {
      const body = c.req.valid("json");
      const result = await cntr.posts.createPost({
        title: body.title,
        content: body.content,
        authorId: body.authorId,
      });
      return toHttp(c, result, { Invalid: 400, Conflict: 409, Unexpected: 500 }, 201);
    });

  return app;
}
```

## 7. Containerへの登録

`src/container.ts`に追加:

```typescript
import { createPostsService } from "./features/posts/application/service";
import { createPostsRepository } from "./features/posts/infrastructure/posts.repository.drizzle";

export function createContainer(config: AppConfig): Container {
  const { db, end } = createDb(config.databaseUrl);

  // ... 既存のコード ...

  const postsRepository = createPostsRepository({ db });
  const posts = createPostsService({ postsRepository });

  return { db, end, posts /* , ... */ };
}
```

## 8. app.ts へのルートマウント

`src/app.ts` の `apiRoutes` にルーターを追加:

```typescript
import { createPostsRouter } from "@features/posts/presentation";

// apiRoutes の定義内で .route("/posts", createPostsRouter(container)) を追加
const apiRoutes = createHonoApp({ router: new RegExpRouter() })
  .route("/health", createHealthRouter({ db: container.db }))
  .route("/users", createUsersRouter(container))
  .route("/posts", createPostsRouter(container));  // 追加
```

## 9. アーキテクチャチェックの実行

実装完了後、依存関係の違反がないか確認します:

```sh
bun run arch:check
```

## 10. テストの追加（推奨）

必要に応じて、以下のテストを追加します:

- **ユニットテスト**: `src/features/posts/application/create/validators.test.ts`など
- **統合テスト**: `src/__tests__/integration/posts.test.ts`など

## チェックリスト

機能追加時に確認すべき項目:

- [ ] Domain層に外部ライブラリの依存がないか
- [ ] DTOはApplication層に定義されているか（Domain層にDTOを持ち込まない）
- [ ] Infrastructure層でマッパーを使用しているか
- [ ] Application層で`Result`型を使用しているか
- [ ] エラー型はファイル先頭に定義されているか
- [ ] Presentation層で`toHttp`を使用しているか
- [ ] Containerに登録されているか
- [ ] app.ts にルーターをマウントしたか
- [ ] ContractsにHTTPスキーマが定義されているか
- [ ] `bun run arch:check`が通るか（`check:feature` の feature 構造完全性チェックを含む）
- [ ] `bun run typecheck`が通るか
- [ ] ロジックを変更した場合は `cd apps/api-service && bun run mutation` で "perpetually green" なテストがないか確認したか
  （詳細は [品質ゲート ガイド](./quality-gates.md)）

## 外部SDKが必要な場合

外部SDK（メール送信、外部APIクライアント、認証ライブラリなど）を使用する場合は、以下の手順を追加します:

1. **Ports定義**: `src/features/xxx/application/ports.ts`にインターフェースを定義
2. **Integration実装**: `src/integrations/xxx.ts`に外部SDKのラッパーを実装（**外部SDKは必ずここに配置**）
3. **Infrastructure実装**: `src/features/xxx/infrastructure/xxx.ts`でPortsを実装し、Integrationを使用
4. **Container登録**: `src/container.ts`で依存関係を組み立て

Application層からはPorts（インターフェース）経由でのみ依存し、`@google-cloud/*` や `google-auth-library` 等の外部ライブラリを直接importしないでください。
