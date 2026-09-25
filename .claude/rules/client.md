---
paths:
  - "apps/client/**/*.ts"
  - "apps/client/**/*.tsx"
---

# client 実装ルール（`apps/client/AGENTS.md` の補足）

データ取得（SSR / useQuery）・mutation・認証パターンは `apps/client/AGENTS.md` を参照。

## actions / queries のテストは `test-helpers/api-mock.ts` を使う

`mock.module("hono/client", ...)` + `let mockOk / mockBody / lastJson` の雛形を**テストファイルに
手書きしない**。`createApiMock()`（+ serverFn なら `reactStartModule` / `reactStartServerModule`）を
使う — 書き始めは import + `mock.module` 2行で済む。手書き雛形は feature の数だけ写経され、
派生プロダクトで計測したところ actions テストの21%・queries テストの25%（計4,100行）に達した。
行カバレッジゲート（80%）の下では写経テストが閾値を満たす最安の方法になるので、ヘルパを先に用意して
書き始めの手数で写経に負けない状態を保っている。
実例: `features/tasks/actions/create-task.test.ts` / `features/tasks/queries/get-tasks.test.ts`。

## actions は `toActionResult`（`shared/lib/action-error.ts`）を通す

API のエラーコード（`"Conflict"` 等）を `message` にそのまま入れて画面に出さない。また fetch 自体の
失敗（オフライン等）で action が reject すると、呼び出し側の pending 状態が戻らずフォームが固まる。
`toActionResult(() => apiClient.api.xxx.$post(...), { messages, fallback })` はどちらも防ぐ —
reject せず、コードを日本語文言に置き換え、`messages` のキーをルートの型から推論するので API 側に
コードが増えると typecheck で対応表の不足が分かる。実例: `features/tasks/actions/create-task.ts`。

## 機械的に強制される規約（arch:guards）

- **`window.location.href` への代入禁止**。TanStack Router の `router.navigate()` / `useNavigate()` を使う。
- `features/` 配下で `process.env` 直参照禁止。client には独自の設定機構が無いので、必要な値は api-service の
  `config.ts` に足して loader / serverFn 経由で受け取る（`.claude/rules/env-vars.md` の「client / Docker のみの場合」）。
- スタイル規約（既定パレット・任意値・`dark:` の手書き・AI slop の定型パターン）。詳細は下の「デザイン規約」。

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

`page.getByRole("link", { name: "..." })` 等の `name` はデフォルトで**部分一致**(substring)なため、
UI 文言をリネームして新しい文字列が既存の別要素の文字列を包含する形になると、リネーム前は
一意だったロケーターが複数要素にマッチして strict mode violation で失敗する。

- リネーム対象の文言を `grep -rn` で **spec ファイルだけでなく `tests/e2e/helpers/` 配下の
  共有ヘルパーも含めて** `apps/client/tests/e2e/` 全体から検索する。
- 衝突を避ける修正は該当ロケーターに `exact: true` を追加する。

## デザイン規約（トークン・コンポーネント・AI slop）

AI が書く UI は、1 つずつは正しく動くため typecheck・lint・test をすべて通過したまま見た目が漂流する
（`text-zinc-500` の直書き、紫のグラデーション、ページごとに違う余白）。これを止めるため、使える語彙を
トークンとコンポーネントに絞り、絞った語彙から外れたものを `scripts/check/client-styles.mjs`（`bun run check:styles`。
`bun run arch:check` にも含まれる）で機械的に検出する。下の各項目の【ガード】は機械検証済み、【目視】は画面を見て確認するもの。
ガードはコメントも全規則でチェックする（絵文字を含む）。禁止クラス名や絵文字をコメントに書かない
（「旧 `text-zinc-500` から置換」のような変更履歴は git に残る。旧実装の説明が要るなら言葉で書く）。

### 色は semantic トークンだけ

| トークン | 用途 |
|---|---|
| `background` / `foreground` | ページの地と本文（body に適用済み。ページ側で背景を塗らない） |
| `card` / `popover`（+ `-foreground`） | 面を分けるコンポーネントの地 |
| `muted` / `muted-foreground` | 補助の面・補足テキスト（日付、件数、説明文） |
| `primary`（+ `-foreground`） | 主要操作。**1 画面で目立たせるのは 1 か所** |
| `secondary` / `accent` | 副次操作・hover の面 |
| `destructive` | エラー文言・削除操作 |
| `border` / `input` / `ring` | 罫線・入力枠・フォーカスリング |
| `chart-1`〜`chart-5` / `sidebar-*` | グラフ系列・サイドバー専用 |

- 【ガード】既定パレット（`text-zinc-500` / `bg-blue-600` / `text-white` …）は使えない。
  `packages/tailwind-config/shared-styles.css` で既定パレットの生成自体を止めてあるが、**未定義のクラスは
  ビルドエラーにならず、何も出力されないまま無色になるだけ**なので、ソース上の使用はガードが検出する
- 【ガード】`dark:` を手書きしない。トークンは `.dark` で値が切り替わるので、トークンを使えば自動で対応する
- 語彙（どのトークンが存在するか）は `packages/tailwind-config/shared-styles.css`、値（ブランドの色）は
  `apps/client/app/globals.css` が持つ。ブランドの差し替えは `globals.css` の値だけで完結させ、
  トークンを足すときは両方に書く

### スケールから選ぶ

- 【ガード】任意値（`w-[347px]` / `bg-[#7c3aed]` / `bg-(--brand)`）と任意プロパティ（`[color:#7c3aed]`）は使えない。Tailwind のスケール
  （`p-4` / `gap-2` / `text-sm`）から選ぶ。どうしても必要な値は `components/` にコンポーネントとして閉じ込める
  （`data-[state=open]:` のような任意バリアントは対象外）
- 【ガード】`style` 属性で見た目を書かない（クラスの規則をすべて迂回できる）。値が実行時に決まるもの
  （進捗バーの幅等）だけは `components/` のコンポーネントの中で使ってよい。SVG の `fill` / `stroke` に色を直接書かず、
  `currentColor` にして色はクラスで付ける。走査対象は `app/` / `features/` / `components/`（`ui/` を除く）/ `shared/`
- 文字サイズと太さの組み合わせを画面ごとに発明しない。使う組み合わせは次の 4 つだけ:

  | 用途 | クラス |
  |---|---|
  | ページ見出し（h1） | 【ガード】`PageHeader` を使う（h1 の直書きは禁止。中身は `text-2xl font-bold`） |
  | セクション見出し（h2 / h3） | `text-base font-medium`（shadcn の `CardTitle` と `EmptyState` の見出しと同じ） |
  | 本文・UI | `text-sm`（強調は `font-medium`） |
  | 補足・注記 | `text-xs text-muted-foreground` |

  `font-bold` は `PageHeader` の中だけに使い、`font-semibold` は使わない（shadcn のコンポーネントが `font-medium` で
  揃っているため。コンポーネントを再生成しても規約とずれない側に合わせる）。
- 字間は Tailwind のスケール（`tracking-tight` / `tracking-wide` / `tracking-wider` / `tracking-widest`
  = 0.1em）から選ぶ。`tracking-[0.1em]` は `tracking-widest` と同じ値なので任意値にしない。日本語の見出し
  などでスケールに無い字間が要るなら、`apps/client/app/globals.css` の `@theme` に `--tracking-*` の
  トークンとして足し（`tracking-<名前>` で使える）、同じ値を画面ごとに書かない
- 【ガード】並べるときの間隔は親の `flex` / `grid` + `gap-*`、コンポーネントの内側は padding で作る。margin
  （`mt-2` / `-mx-4`）と `space-y-*` / `space-x-*` は使えない（中央寄せの `mx-auto` 等 `auto` は可）
- 正方形は `size-*`（`w-* h-*` を並べない）、条件付きクラスは `cn()`（`@/shared/lib/utils`）で合成する

### 既存のコンポーネントを先に探す

新しい UI を書く前に、既存のコンポーネントで組めないかを確認する。

- `components/ui/`: shadcn のコンポーネント（`Button` / `Card` / `Input` / `Skeleton`）。shadcn CLI の生成物なので
  手で書き換えない。足りないコンポーネントは shadcn CLI で追加する（`components.json` の `style: base-vega` /
  Base UI 前提。Radix 前提の例をそのまま貼らない）。同じ場所にある `ThemeToggle` は手書きのコンポーネントで
  書き換えてよいが、スタイルガードの対象外なので規約は目視で守る
- `components/patterns/`: 画面パターン（`PageHeader` / `EmptyState` / エラー表示 / NotFound）
- `components/layout/`: ページ枠（`CenteredPage`）と常駐バナー
- コンポーネントに渡す `className` は**配置（余白・幅・並び）だけ**に使い、色や文字を上書きしない。見た目の違いは
  `variant` / `size` で表す（例: 削除は `<Button variant="destructive">`、控えめな操作は `variant="ghost"`）

### 状態を必ず作る

- 読み込み中: `Skeleton`（スピナーだけで画面を空にしない）
- 空: `EmptyState`（「無い」ではなく次の行動を示す。`features/tasks/ui/task-list.tsx` が実例）
- エラー: `role="alert"` + `text-destructive`
- 送信中: 対象のボタンを `disabled` にする（`features/tasks/ui/task-list.tsx` の `pendingId` が実例）

### AI slop を避ける

LLM は学習データの多数派に収束するため、指示が無いと「どこかで見た AI 製の画面」を出す。業務アプリの
テンプレートとして、**情報密度と一貫性を優先し、装飾で差をつけない**。

<!-- textlint-disable -->

| パターン | 検出 |
|---|---|
| グラデーション背景・グラデーション文字（`bg-linear-*` / `bg-clip-text`） | 【ガード】 |
| すりガラス（`backdrop-blur-*`） | 【ガード】（オーバーレイは `components/ui` のコンポーネントに任せる） |
| 絵文字をアイコン代わりに使う | 【ガード】（アイコンは `lucide-react`。`components.json` の `iconLibrary` と揃えてある） |
| 紫・青の差し色を既定パレットから持ち込む | 【ガード】（既定パレット禁止で検出） |
| Card の中に Card を入れる | 【目視】 |
| 同じ形のカードを 3 列に並べる・中央寄せの hero + 小さなバッジ | 【目視】 |
| 全要素に hover 演出・スクロールで fade-in・`animate-bounce` | 【目視】 |
| 順序でない項目への 01/02/03 の番号振り・全大文字の小見出しラベル | 【目視】 |
| 意味の無いアイコンを見出しごとに散らす | 【目視】 |
| 「シームレスに」「次のレベルへ」のような中身の無い定型文言 | 【ガード】語彙の一部（下の「UI 文言の書き方」）。残りは【目視】 |

<!-- textlint-enable -->

slop とされるパターンは流行とともに変わる（2026-09-25 時点の一覧。出典は Anthropic の frontend-design
skill と shadcn の agent skill）。**半年を目安に見直し**、機械検出できる項目が増えたら
`scripts/check/client-styles.mjs` の規則と `scripts/check/arch-guards.selftest.sh` の既知違反を足す。

### UI 文言の書き方

<!-- textlint-disable -->

画面の文言には、読んだ人が次に何をすればいいかを書く。LLM は指示が無いと「適切な」「シームレスな」の
ように、どの画面にも当てはまる言葉で埋める。

- 何が起きたかと、次の操作を書く。エラー文言は `toActionResult` の `messages` に API のエラーコードごとに書く
  - NG: 「エラーが発生しました。適切な値を入力してください」
  - OK: 「タイトルは1〜200文字で入力してください」（`features/tasks/actions/create-task.ts`）
- 空状態は「無い」で終わらせず、次の操作を示す
  - OK: 「タスクはまだありません」+「上のフォームから最初のタスクを追加できます。」（`features/tasks/ui/task-list.tsx`）
- 誇張しない。「革命的な」「完璧な」「次世代の」は使わず、できることをそのまま書く
- 比喩の動詞を使わない。「効く」「走る」「落ちる」「潰す」は、何がどうなるかを書く言葉に置き換える
  - NG: 「この設定が効きます」 / OK: 「この設定をオンにすると、通知メールが止まります」
- 全角ダッシュ（——）で文をつながない。句点で文を分ける
- 敬体（です・ます）でそろえる。「〜することができます」は「〜できます」と書く

<!-- textlint-enable -->

`bun run check:ui-copy`（`arch:guards` に含まれる）が client の TS / TSX から日本語の文字列を取り出して
textlint で調べる。語彙は p1ass/textlint-rule-preset-ai-words-ja、誇張と冗長な言い回しは
textlint-ja/textlint-rule-preset-ai-writing、プロダクト独自の語は `scripts/check/ai-words.json`、全角ダッシュは
`scripts/check/ui-copy.mjs` の正規表現が見る。コメントは画面に出ないので対象外。Claude Code では TS / TSX を
編集した直後にも `.claude/hooks/on-ts-edit.sh` が整形の後に同じチェックをかけて指摘を返す。

- 指摘されたら文言を直す。その語が画面の用語として必要なときだけ、`.textlintrc.json` の `allows` に足す
  （検証器の変更なので、PR 本文の「検証器の変更理由」に理由を書く）
- 辞書で拾えるのは語と言い回しだけで、「どの画面にも当てはまる文」は拾えない。画面の確認（下の節）で読む
<!-- textlint-disable -->

- 語の一覧は、上の見た目の表と同じく半年を目安に見直す。AI が書く日本語の癖はモデルの世代で変わる
  （以前は「シームレスな」「極めて重要な」、最近は「効く」「走る」のような比喩の動詞）

<!-- textlint-enable -->

### 画面で確認してから完了にする

【目視】の項目と余白・揃えの崩れはガードでは拾えない。UI を変えたら dev サーバーで対象ページを開き、
スクリーンショットを撮って上の表と照らし合わせる。

- 幅はモバイル（375px）とデスクトップの 2 つ、テーマはライトとダークの 2 つ
- 見るもの: 目立たせている箇所が 1 つか、余白と文字サイズが既存ページと揃っているか、【目視】の項目
- 確認できなかった場合（dev サーバーが起動しない等）は、確認したと書かずにその旨を PR 本文に残す

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
