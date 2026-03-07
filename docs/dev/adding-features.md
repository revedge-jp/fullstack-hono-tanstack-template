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
  │   └── posts.repository.prisma.ts   # リポジトリ実装
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
import type { Result } from "@repo/result";

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
    return { type: "err", value: "Invalid" };
  }
  // 他のドメイン不変条件（contentの長さチェックなど）があればここに追加
  return { type: "ok", value: null };
}

// リポジトリインターフェース（抽象）
export type PostsRepository = {
  list(): Promise<Post[]>;
  create(input: {
    title: string;
    content: string;
    authorId: number;
  }): Promise<Result<Post, "Conflict" | "Unexpected">>;
  getById(id: number): Promise<Post | null>;
};
```

**注意事項**:
- Domain層は外部ライブラリ（Zod、Prisma、HTTP等）に依存しない
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

`src/features/posts/infrastructure/posts.repository.prisma.ts`:

```typescript
import type { PrismaClient } from "@repo/db";
import { err, ok, type Result } from "@repo/result";
import type { PostsRepository, Post } from "../domain/posts.repository";
import { mapDbPostToDomain } from "./mappers";

export function createPostsRepository(deps: { prisma: PrismaClient }): PostsRepository {
  const { prisma } = deps;

  return {
    async list(): Promise<Post[]> {
      const rows = await prisma.post.findMany({ orderBy: { id: "desc" } });
      return rows.map(mapDbPostToDomain);
    },
    async create(input: {
      title: string;
      content: string;
      authorId: number;
    }): Promise<Result<Post, "Conflict" | "Unexpected">> {
      try {
        const row = await prisma.post.create({ data: input });
        return ok(mapDbPostToDomain(row));
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          (e as { code?: string }).code === "P2002"
        ) {
          return err("Conflict");
        }
        return err("Unexpected");
      }
    },
    async getById(id: number): Promise<Post | null> {
      const row = await prisma.post.findUnique({ where: { id } });
      return row ? mapDbPostToDomain(row) : null;
    },
  };
}
```

## 4. Application層の実装

### 4.1. バリデーション

**ユースケースの入出力（DTO）は Application 層で定義します。**
Application層のバリデータは、1) 契約スキーマのチェック と 2) ドメイン不変条件のチェック（Domain層へ委譲）を行います。

`src/features/posts/application/create/validators.ts`:

```typescript
import { err, ok, type Result } from "@repo/result";
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
    return err("Invalid");
  }

  // 2. ドメイン不変条件をチェック (Domain層へ委譲)
  // DTOを分解して、プリミティブな値をDomain関数に渡す
  const domainResult = validatePostInvariants(input.title, input.content);
  if (domainResult.type === "err") {
    return err("Invalid");
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
import { err, isOk, ok, type Result } from "@repo/result";
import type { PostsRepository } from "../../domain/posts.repository";
import type { CreatePostInput } from "./validators";

// 入出力型（ファイルローカル）
type CreatePostStepInput = CreatePostInput;
type CreatePostStepOutput = Result<{ item: { id: number } }, "Conflict" | "Unexpected">;

export function makeCreatePostStep(deps: { postsRepository: PostsRepository }) {
  const { postsRepository } = deps;
  return async function createPostStep(
    i: CreatePostStepInput
  ): Promise<CreatePostStepOutput> {
    const created = await postsRepository.create(i);
    if (isOk(created)) {
      return ok({ item: { id: created.value.id } });
    }
    if (created.value === "Conflict") {
      return err("Conflict");
    }
    return err("Unexpected");
  };
}
```

### 4.3. ユースケース

`src/features/posts/application/create/usecase.ts`:

```typescript
import type { PostsRepository } from "../../domain/posts.repository";
import { flow, type Result } from "@repo/result";
import { makeCreatePostStep } from "./steps";
import { type CreatePostInput, validateCreatePost } from "./validators";

type CreatePostError = "Conflict" | "Invalid" | "Unexpected";

export function makeCreatePost(deps: { postsRepository: PostsRepository }) {
  const createPostStep = makeCreatePostStep(deps);
  return async function createPost(
    input: CreatePostInput
  ): Promise<Result<{ item: { id: number } }, CreatePostError>> {
    return flow<CreatePostInput, CreatePostError>(input)
      .andThen(validateCreatePost)
      .asyncAndThen(createPostStep)
      .value();
  };
}
```

### 4.4. リストユースケース（例）

`src/features/posts/application/list/steps.ts`:

```typescript
import { err, ok, type Result } from "@repo/result";
import type { Post, PostsRepository } from "../../domain/posts.repository";

type FetchPostsStepInput = null;
type FetchPostsStepOutput = Result<{ items: Post[] }, "Unexpected">;

export function makeFetchPostsStep(deps: { postsRepository: PostsRepository }) {
  const { postsRepository } = deps;
  return async function fetchPostsStep(
    _: FetchPostsStepInput
  ): Promise<FetchPostsStepOutput> {
    try {
      const items = await postsRepository.list();
      return ok({ items });
    } catch {
      return err("Unexpected");
    }
  };
}
```

`src/features/posts/application/list/usecase.ts`:

```typescript
import type { Post, PostsRepository } from "../../domain/posts.repository";
import { flow, type Result } from "@repo/result";
import { makeFetchPostsStep } from "./steps";

type ListPostsError = "Unexpected";

export function makeListPosts(deps: { postsRepository: PostsRepository }) {
  const fetchPostsStep = makeFetchPostsStep(deps) as (
    _: null
  ) => Promise<Result<{ items: Post[] }, "Unexpected">>;
  return async function listPosts(): Promise<Result<{ items: Post[] }, ListPostsError>> {
    return flow<null, ListPostsError>(null).asyncAndThen(fetchPostsStep).value();
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
import { zValidator } from "@hono/zod-validator";
import { isOk } from "@repo/result";
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
      if (!isOk(result)) return c.json({ message: "unexpected" }, 500);
      return c.json(result.value, 200);
    })
    .post("/", zValidator("json", CreatePostRequestSchema), async (c) => {
      const body = c.req.valid("json");
      const result = await cntr.posts.createPost({
        title: body.title,
        content: body.content,
        authorId: body.authorId,
      });
      if (!isOk(result)) {
        if (result.value === "Invalid") return c.json({ message: "invalid" }, 400);
        return c.json({ message: "unexpected" }, 500);
      }
      return c.json(result.value, 201);
    });

  return app;
}
```

## 7. Containerへの登録

`src/container.ts`に追加:

```typescript
import { createPostsService } from "./features/posts/application/service";
import { createPostsRepository } from "./features/posts/infrastructure/posts.repository.prisma";

export function createContainer(config: AppConfig) {
  const prisma = prismaClient;

  // ... 既存のコード ...

  const postsRepository = createPostsRepository({ prisma });
  const posts = createPostsService({ postsRepository });

  return { users, posts };
}
```

## 8. app.ts へのルートマウント

`src/app.ts` の `apiRoutes` にルーターを追加:

```typescript
import { createPostsRouter } from "@features/posts/presentation";

// apiRoutes の定義内で .route("/posts", createPostsRouter(container)) を追加
const apiRoutes = createHonoApp({ router: new RegExpRouter() })
  .route("/health", createHealthRouter({ prisma: container.prisma }))
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
- [ ] `bun run arch:check`が通るか
- [ ] `bun run typecheck`が通るか

## 外部SDKが必要な場合

外部SDK（メール送信、外部APIクライアント、認証ライブラリなど）を使用する場合は、以下の手順を追加します:

1. **Ports定義**: `src/features/xxx/application/ports.ts`にインターフェースを定義
2. **Integration実装**: `src/integrations/xxx.ts`に外部SDKのラッパーを実装（**外部SDKは必ずここに配置**）
3. **Infrastructure実装**: `src/features/xxx/infrastructure/xxx.ts`でPortsを実装し、Integrationを使用
4. **Container登録**: `src/container.ts`で依存関係を組み立て

Application層からはPorts（インターフェース）経由でのみ依存し、`@google-cloud/*` や `google-auth-library` 等の外部ライブラリを直接importしないでください。
