# AGENTS.md — client

`apps/client` 固有の規約の正典。リポジトリ全体の規約（Stack・コマンド・TypeScript Style 等）は
ルートの `../../AGENTS.md` にあり、ここには複製しない。Claude Code は同じディレクトリの `CLAUDE.md`
（`@AGENTS.md` を取り込むだけ）経由で、このディレクトリのファイルを読んだときにこれを読み込む。

あわせて読むもの（Claude Code 以外のツールは自動ロードされない）:

- `../../.claude/rules/client.md` — SSR / `window` 参照 / a11y / テストヘルパ
- `../../.claude/rules/logging.md` — ログを出すコードを書くとき（生の `console.*` 禁止・`error`/`err` キーの使い分け）
- `../../.claude/rules/env-vars.md` — 環境変数を足すとき

参照実装は `features/tasks`。actions / queries のテストは `test-helpers/api-mock.ts` から書き始める。

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

## Testing Conventions

### What tests to write (per feature addition)

**client — always:**
- `actions/{action}.test.ts` (co-located)
- `queries/{query}.test.ts` (co-located)

**client — skip:** UI component tests (server component rendering tests have high cost/low value)
