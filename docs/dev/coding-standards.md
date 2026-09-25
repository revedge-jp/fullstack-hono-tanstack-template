# コーディング規約

fullstack-hono-tanstack-template のコーディング規約です。

## 基本方針

- 目先の安易な解決策ではなく、プロダクトの寿命が長くなる本質的な解決策を選ぶ
- 既存コードのスタイル・規約を尊重し、一貫性を保つ
- 可読性と保守性を優先する

---

## TypeScript

### 命名規則

| 対象 | 規則 | 例 |
|------|------|-----|
| 変数・関数 | camelCase | `getUserById`, `isValid` |
| 定数 | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 型（`type`） | PascalCase | `UserRepository`, `CreatePostInput` |
| ファイル名 | kebab-case | `user-repository.ts`, `create-post.ts` |

`class` / `interface` は使わない（型は `type`、実装は関数とオブジェクトで書く。`bun run arch:guards` が検出する）。

```typescript
// ✅ 良い例
const userName = "John";
function validateEmail(email: string): boolean { ... }
type UserResponse = { ... };

// ❌ 悪い例
const user_name = "John";  // snake_caseは使わない
const u = "John";          // 短すぎる名前は避ける
```

### 命名のベストプラクティス

- **1〜2文字の短い名前は避ける**（`i`, `j` 等のループ変数は例外）
- **関数は動詞で始める**: `getUser`, `createPost`, `validateInput`
- **変数は名詞**: `user`, `postList`, `errorMessage`
- **省略語より可読性を優先**: `btn` → `button`, `msg` → `message`

### 型

#### 型アサーション（`as`キャスト）は原則禁止

型安全性を損なうため、以下の代替手段を優先：

```typescript
// ❌ 悪い例
const status = row.status as JobStatus;

// ✅ 良い例: 型ガード関数を使用
function isValidJobStatus(value: string): value is JobStatus {
  return value === "queued" || value === "processing" || value === "done";
}

if (!isValidJobStatus(row.status)) {
  throw new Error(`Invalid job status: ${row.status}`);
}
// ここでrow.statusはJobStatus型に絞り込まれている
```

**許容される例外**（詳細判定フローは [ADR-003](../architecture/adr-003-as-type-assertion-policy.md) / ブランド型は [ADR-004](../architecture/adr-004-branded-types-as-cast.md)）:
- `as const`（リテラル型の固定）
- `import { X as Y }`（名前の変更）
- `*.test.ts` 内のキャスト
- ブランド型ファクトリ（`makeXxx`）・再構築関数（`reconstituteXxx`）内のバリデーション/信頼済みデータに限定したキャスト

#### 型のエクスポート

```typescript
// ❌ 外部に不要な型をエクスポートしない
export type InternalState = { ... };

// ✅ ファイルローカルで十分な型はexportしない
type InternalState = { ... };
```

#### `any` は使用禁止

```typescript
// ❌ 悪い例
function process(data: any) { ... }

// ✅ 良い例
function process(data: unknown) { ... }
function process<T>(data: T) { ... }
```

### Zodバリデーション

Zod v4以降では、`z.string().email()` は非推奨：

```typescript
// ❌ 非推奨（Zod v3以前の書き方）
const schema = z.object({
  email: z.string().email(),
  url: z.string().url(),
});

// ✅ 推奨（Zod v4以降）
const schema = z.object({
  email: z.email(),
  url: z.url(),
});

// メソッドチェーンも可能
const schema = z.object({
  email: z.email().max(320),
});
```

### 制御フロー

#### ガード節（早期return）を優先

```typescript
// ❌ 悪い例: 深いネスト
function processUser(user: User | null) {
  if (user) {
    if (user.isActive) {
      if (user.role === "admin") {
        // 処理
      }
    }
  }
}

// ✅ 良い例: ガード節
function processUser(user: User | null) {
  if (!user) return;
  if (!user.isActive) return;
  if (user.role !== "admin") return;
  
  // 処理
}
```

#### 無意味な try/catch は禁止

```typescript
// ❌ 悪い例: 何もしないcatch
try {
  doSomething();
} catch (e) {
  // 何もしない
}

// ✅ 良い例: 捕まえたら扱いを決める（pino はオブジェクトが第1引数、メッセージが第2引数）
try {
  doSomething();
} catch (error) {
  logger.error({ err: error }, "Failed to do something");
  throw error;
}
```

api-service では throw を使わない（middlewares・`config.ts`・テストを除く `src/` 全体。`usecase.ts` は try/catch も禁止）。
失敗しうる Promise は `ResultAsync.fromPromise` で Result にする（下の「Result型」と ADR-005）。`err` / `error` キーを使ってよい
ログレベルは [`.claude/rules/logging.md`](../../.claude/rules/logging.md) を参照。

### コメント

```typescript
// ❌ 自明なコメントは書かない
// ユーザーを取得する
const user = getUser(id);

// ✅ 非自明な理由・前提・注意点のみ
// BigQueryの制限により、一度に取得できるのは1000件まで
const users = await fetchUsers({ limit: 1000 });
```

---

## Result型（ROP、neverthrow）

[ADR-005](../architecture/adr-005-neverthrow-for-error-handling.md) により [neverthrow](https://github.com/supermacro/neverthrow) を採用している。

### 基本パターン

```typescript
import { ok, err, okAsync, type Result, type ResultAsync } from "neverthrow";

// 成功
return ok({ item: { id: created.id } });
return okAsync({ item: { id: created.id } });

// 失敗（as const でリテラル型を維持する）
return err("NotFound" as const);
return err("Conflict" as const);
```

### ユースケースの型配置

```typescript
// ✅ ファイル先頭に型を定義（非export）、usecase.ts は async/try-catch 禁止
type CreatePostError = "Invalid" | "Conflict" | "Unexpected";

export function makeCreatePost(deps: Dependencies) {
  const createPostStep = makeCreatePostStep(deps);
  return function createPost(
    input: CreatePostInput
  ): ResultAsync<{ item: { id: number } }, CreatePostError> {
    return okAsync(input)
      .andThen(validateCreatePost)
      .andThen(createPostStep);
  };
}
```

### ステップ関数

```typescript
// ✅ 入出力の型はファイルローカル
type CreatePostStepInput = CreatePostInput;
type CreatePostStepOutput = ResultAsync<{ item: { id: number } }, "Conflict" | "Unexpected">;

export function makeCreatePostStep(deps: { postsRepository: PostsRepository }) {
  const { postsRepository } = deps;
  return function createPostStep(i: CreatePostStepInput): CreatePostStepOutput {
    return postsRepository.create(i);
  };
}
```

---

## api-service（クリーンアーキテクチャ）

feature の構成・依存方向・ROP のパターンは [`apps/api-service/AGENTS.md`](../../apps/api-service/AGENTS.md) が
正典（依存方向は dependency-cruiser が強制する）。ここでは層ごとの要点だけ示す。

### 層の責務

| 層 | 責務 | 依存先 |
|----|------|--------|
| **presentation** | HTTP I/O、リクエストのバリデーション（`router.ts`） | application |
| **application** | ユースケース、DTO定義 | domain, ports |
| **domain** | ドメインモデル、ビジネスルール | なし（純粋） |
| **infrastructure** | リポジトリ実装 | domain, integrations/external |
| **integrations** | `external/`: 外部SDKラッパー / `composition/`: feature 間 adapter | 外部SDK / 各 feature の application |

### Domain層のルール

```typescript
// ❌ Domain層に外部ライブラリを持ち込まない
import { z } from "zod";  // NG
import type { Database } from "@repo/db";  // NG

// ✅ 純粋な関数・型のみ
export function isValidPostTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= 1 && trimmed.length <= 200;
}
```

### DTOの配置

```typescript
// ✅ DTOはApplication層で定義
// application/create/validators.ts
export type CreatePostInput = { title: string; content: string };

// ❌ Domain層にDTOを持ち込まない
// domain/posts.repository.ts
export type CreatePostInput = { ... };  // NG
```

### 外部SDKの扱い

```typescript
// ✅ integrations/external にラッパーを作成
// src/integrations/external/send-email.ts
import { SomeEmailClient } from "some-email-sdk";

export async function sendEmail(params: SendEmailParams) {
  const client = new SomeEmailClient();
  // 実装
}

// ❌ 他の層から直接importしない
// src/features/notifications/application/steps.ts
import { SomeEmailClient } from "some-email-sdk";  // NG
```

---

## client（FSD）

構成・データ取得・mutation・認証のパターンは [`apps/client/AGENTS.md`](../../apps/client/AGENTS.md) が正典。

### 依存ルール

- `shared` から `features` への import は禁止
- `features` 間の直接 import は禁止（避ける、ではない）。複数の feature で使うものは `shared/` か `components/` に置く

### API呼び出し

- ブラウザからは `@/shared/lib/browser-api-client` の `browserApiClient`、SSR（`createServerFn`）からは
  `@/shared/lib/api-client` の `getApiClient()` を使う。`hc<AppType>()` を各ファイルで作らない
- 取得の失敗は空配列や `null` で返さず throw し、ルートの errorComponent に任せる（「0 件」と区別できなくなる）。
  例外は SSR の 401/403 だけ（`apps/client/AGENTS.md` の「Auth pattern」）
- 実例: `apps/client/features/tasks/queries/get-tasks.ts`

---

## アクセシビリティ（WCAG 2.2 AA）

準拠の基準として **WCAG 2.2 AA** を採用する。

機械検証は 2 層で行う:
- **静的**: oxlint の `jsx-a11y` プラグイン（`.oxlintrc.json`）— `alt` 欠落・不正な ARIA role 等を pre-commit / `bun run lint` で検出
- **実行時**: axe-core による E2E スキャン（`apps/client/tests/e2e/a11y.spec.ts`）— コントラスト比・ラベルの結び付き等を検査。`bun run test:e2e --project=a11y` で単体実行可

### 基本ルール

- フォーカス可視化は `focus-visible:ring-*` で必ず付ける
- テキストと背景のコントラスト比は 4.5:1 以上を確保する
- 色だけで状態を伝達しない（テキストやアイコンを併用）
- エラーメッセージには `role="alert"` を付ける
- 操作は `button`、ページ遷移は `Link` を使う

### a11y チェックリスト

- キーボード操作だけで到達・操作できる
- フォーカスが視認できる（focus-visible）
- テキストと背景のコントラスト比が 4.5:1 以上
- 状態やエラーを色以外でも伝達している
- 重要な動的メッセージには `role="alert"` を付与
- ボタンは `button`、遷移は `Link` + `buttonVariants` を使っている
- セマンティックHTML（見出し階層 h1〜h6、ランドマーク role）を適切に使用している
- 画像には代替テキスト（`alt`）を付与している（装飾画像は `alt=""`）

---

## パッケージ管理

### Bunコマンドを使用

```bash
# ✅ 依存の追加
cd apps/api-service
bun add zod

# ✅ 開発依存の追加
bun add -d @types/node

# ✅ 削除
bun remove lodash

# ❌ package.jsonの手動編集は禁止
```

### バージョン指定

```bash
# ✅ 通常は不要（公開から 3 日経った最新版がインストールされる — bunfig.toml の minimumReleaseAge）
bun add hono

# ✅ 必要時のみ指定
bun add hono@4.0.0
```

---

## Git

### コミットメッセージ

```bash
# ✅ Conventional Commits
feat: ユーザー登録機能を追加
fix: ログイン時のエラーハンドリングを修正
docs: READMEを更新
refactor: ユーザーサービスをリファクタリング
test: ユーザー作成のテストを追加
chore: 依存関係を更新
```

### ブランチ命名

```bash
# ✅ プレフィックス付き
feat/add-user-registration
fix/login-error-handling
docs/update-readme
refactor/user-service
```

---

## ファイル・ディレクトリ

### インデント

- 既存ファイルのインデント（タブ/スペース、幅）は必ず維持
- 変換・混在をしない
- 新規ファイルは2スペースを推奨

### ファイル命名

```bash
# ✅ kebab-case
user-repository.ts
create-post-step.ts
get-users.ts

# ❌ その他の命名
UserRepository.ts      # PascalCase（ファイル名には使わない）
user_repository.ts     # snake_case（使わない）
```

---

## テスト

どこに何のテストを書くか・書き始めに開く実物は [テストガイド](testing.md) を参照。Result は
`isOk()` / `isErr()` で絞ってから `value` / `error` を検証する（旧 API の `result.type === "ok"` は
api-service では `bun run arch:guards` が検出する）。

---

## 自動チェック

### コミット前に実行

```bash
# まとめて検証（推奨）
bun run check-all

# 個別実行
bun run lint          # Lint（oxlint + oxfmt --check）
bun run lint:fix      # Lint 自動修正
bun run typecheck     # 型チェック
bun run test          # テスト
bun run arch:check    # アーキテクチャチェック
```

### アーキテクチャチェック

```bash
# 依存ルール検証
bun run arch:dc       # dependency-cruiser

# FSD検証
bun run arch:fsd      # steiger

# 構文・配置ガード
bun run arch:guards   # カスタムスクリプト

# 未使用コード検出
bun run knip
```

---

## 関連ドキュメント

- [開発ガイド](development.md) - 開発環境の詳細
- [機能追加の入口](adding-features.md) - feature を足すときに読む正典と参照実装の案内
- [ドメインモデル設計](../architecture/domain-model.md) - DDD/ROPの詳細
- [api-service README](../../apps/api-service/README.md) - サーバー側の詳細
- [client README](../../apps/client/README.md) - クライアント側の詳細

