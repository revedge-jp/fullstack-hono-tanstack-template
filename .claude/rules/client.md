---
paths:
  - "apps/client/**/*.ts"
  - "apps/client/**/*.tsx"
---

# client 実装ルール（AGENTS.md の補足)

データ取得（SSR / useQuery）・mutation・認証パターンは AGENTS.md を参照。

## actions / queries のテストは `test-helpers/api-mock.ts` を使う

`mock.module("hono/client", ...)` + `let mockOk / mockBody / lastJson` の雛形を**テストファイルに
手書きしない**。`createApiMock()`（+ serverFn なら `reactStartModule` / `reactStartServerModule`）を
使う — 書き始めは import + `mock.module` 2行で済む。手書き雛形は feature の数だけ写経され、
派生プロダクトの実測で actions テストの21%・queries テストの25%（計4,100行）に達した。
実例: `features/tasks/actions/create-task.test.ts` / `features/tasks/queries/get-tasks.test.ts`。

## 機械的に強制される規約（arch:guards）

- **`window.location.href` への代入禁止**。TanStack Router の `router.navigate()` / `useNavigate()` を使う。
- `features/` 配下で `process.env` 直参照禁止（`loadConfig()` 経由に統一）。
- UI コンポーネントから `processXxx` の直接 import 禁止（`xxxAction` 経由に統一）。

## `window` などブラウザ専用 API はコンポーネントの render 本体で直接参照しない

TanStack Start は初回表示を SSR するため、`window`/`document`/`navigator` をコンポーネントの
render 本体（`return` の前）で直接読むと `window is not defined` でサーバー側の描画が丸ごと
クラッシュする。`"use client"` ディレクティブはこのリポジトリでは RSC 未導入のため no-op で、
SSR を止める効果は無い。

- **クリックなどのイベントハンドラ内でのみ読む**のが最も簡単な回避策。
- render 本体で値として表示する必要がある場合は、該当箇所を `@tanstack/react-router` の
  `ClientOnly` で包み、`fallback` に SSR 時のプレースホルダ（`Skeleton` 等）を渡す。
- UI コンポーネントの変更は `bun run typecheck`/`lint`/`test` だけでは検出できない（SSR は
  実際にサーバーでレンダーして初めて再現する）。ローカルで dev サーバーを起動し、対象ページを
  実際に取得して確認する。

## TanStack Router の `<Link>` は自前の isActive 判定と競合する

`<Link>` は `activeOptions.exact`（既定 `false`）に基づく**自身のアクティブ判定**を持ち、
自身がアクティブと判断すると `data-status="active"` / `aria-current="page"` を、
**呼び出し側が渡した props の後から spread して上書きする**。

独自の `isActive` を計算して `aria-current`/`className` を制御していても、`<Link>` に
`activeOptions={{ exact: true }}` を渡さない限り、Router 自身の既定（非 exact = 祖先パスも
アクティブとみなす prefix 判定）が別途発火し、独自ロジックの結果を `aria-current` 上で
無効化する。自前の `isActive` に一本化したいときは、対象の `<Link>` に
`activeOptions={{ exact: true }}` を明示する。

## 既存のリーフページの子パスへ新規ルートを足すときは `_` を付ける — 付け忘れは「エラーにならず表示が変わらない」

`tasks.$taskId.tsx` のような**既に単体のリーフページとして存在する**ファイルに対し、その URL の下の
階層（例: `/tasks/$taskId/edit`）を新規ルートとして足すとき、ファイル名を素直に `tasks.$taskId.edit.tsx`
とすると、TanStack Router のファイルベースルーティングはこれを親（`tasks.$taskId.tsx`）の**子ルート**と
してネストする。親の component は `<Outlet />` を持たない（リーフなので当然）ため、新ルートへ遷移しても
**親の内容が表示されたまま変わらない**。

**typecheck・lint・test のどれも検知しない。** ルートは `routeTree.gen.ts` に正しく登録され、`to=` の型
検証も通り、component も存在する — ただし決して呼ばれない。

回避策は親セグメントの末尾に `_` を付けたファイル名にすること（`tasks.$taskId_.edit.tsx`）。これは
「親レイアウトへネストしない」明示指定で、`_` は URL には出ない（`createFileRoute` に渡すパス文字列には
残る）。新規ルートを足したら、typecheck だけでなく**実際にブラウザで遷移して表示が変わること**を確かめる。
出典: revedge-jp/chiryonavi#1184（実機で遷移して初めて発見し、デバッグに数手番を要した）。

## UI 文言のリネームは Playwright ロケーターの部分一致衝突を全ファイル横断で確認する

`page.getByRole("link", { name: "..." })` 等の `name` は既定で**部分一致**(substring)なため、
UI 文言をリネームして新しい文字列が既存の別要素の文字列を包含する形になると、リネーム前は
一意だったロケーターが複数要素にマッチして strict mode violation で壊れる。

- リネーム対象の文言を `grep -rn` で **spec ファイルだけでなく `tests/e2e/helpers/` 配下の
  共有ヘルパーも含めて** `apps/client/tests/e2e/` 全体から検索する。
- 衝突を避ける修正は該当ロケーターに `exact: true` を追加する。

## アクセシビリティ（WCAG 2.2 AA）

`alt` 欠落・不正な ARIA 等は oxlint の `jsx-a11y` プラグインが、コントラスト比・ラベルの結び付き等は
E2E の axe スキャン（`tests/e2e/a11y.spec.ts`）が機械検証する。以下は生成時に守る指針。

- キーボードだけで到達・操作できること。フォーカス可視化は `focus-visible:ring-*` を必ず付ける。
- テキストと背景のコントラスト比は 4.5:1 以上。
- 色だけで状態を伝達しない（テキスト・アイコンを併用）。エラーメッセージには `role="alert"`。
- 操作は `button`、ページ遷移は `Link`（+ `buttonVariants`）。セマンティック HTML（見出し階層・ランドマーク）を使う。
- 画像には `alt` を付与（装飾画像は `alt=""`）。

## React パフォーマンスの要点

- **独立した非同期処理は `Promise.all()` で並列化**する。逐次 await のウォーターフォールを作らない。分岐で使わない値の await は分岐の中へ遅延させる。
- **props/state から計算できる値は state に持たない**。effect で setState して同期するのではなく、レンダー中に導出する。
- ユーザー操作起点の副作用は effect ではなく**イベントハンドラ内**で実行する。
- 現在値に依存する setState は**関数型更新**（`setItems(curr => ...)`）にする。stale closure と useCallback の依存増殖を防ぐ。
- 高コストな初期値は `useState(() => ...)` の**遅延初期化**にする。
- プリミティブを返す単純な式を `useMemo` で包まない。
- effect の依存はオブジェクトではなくプリミティブに絞る（`[user]` ではなく `[user.id]`）。
