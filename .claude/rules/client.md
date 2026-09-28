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
- client（`app/`・`features/`・`shared/`・`components/`）で `process.env` 直参照禁止。client には独自の設定機構が無いので、必要な値は api-service の
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
出典: 派生プロダクトでの実例（実機で遷移して初めて発見し、デバッグに数手番を要した）。

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

デザインの基準は [SmartHR Design System](https://smarthr.design/)（以下 SmartHR DS）に合わせる。取り込むのは
値（色・角丸・余白の段階）と、ライティング・アクセシビリティ・画面パターンのガイドラインで、実装ライブラリの
smarthr-ui は使わない（理由は `docs/architecture/adr-008-smarthr-design-system-guidelines.md`）。コンポーネントは
shadcn / Base UI のままなので、SmartHR DS に出てくるコンポーネント（`ActionDialog` / `DefinitionList` 等）は、
同じ役割を持つ shadcn のコンポーネントで組む。この節に無いことで迷ったら、SmartHR DS の該当ページを読んで合わせる
（原稿は GitHub の `kufu/smarthr-design-system` の `src/content/articles/` にもある）。

### 色は semantic トークンだけ

| トークン | 用途 | SmartHR DS のトークン |
|---|---|---|
| `background` / `foreground` | ページの地と本文（body に適用済み。ページ側で背景を塗らない） | `WHITE` / `TEXT_BLACK` |
| `card` / `popover`（+ `-foreground`） | 面を分けるコンポーネントの地 | `WHITE` |
| `muted` / `muted-foreground` | 補助の面・補足テキスト（日付、件数、説明文） | `OVER_BACKGROUND` / `TEXT_GREY` |
| `primary`（+ `-foreground`） | 主要操作。**1 画面で目立たせるのは 1 か所** | `MAIN` |
| `secondary` / `accent` | 副次操作・hover の面 | `OVER_BACKGROUND` |
| `destructive` | エラー文言・削除操作 | `DANGER`（明るさを下げた値） |
| `border` / `input` / `ring` | 罫線・入力枠・フォーカスリング | `BORDER` / `BORDER` / `OUTLINE` |
| `chart-1`〜`chart-5` / `sidebar-*` | グラフ系列・サイドバー専用 | `CHART_COLOR_1`〜`5` / `COLUMN` |

値と、SmartHR DS の値からずらした箇所の理由（コントラスト比）は `apps/client/app/globals.css` のコメントにある。
SmartHR DS にはダークモードが無いので、`.dark` の値はこのリポジトリで作ったもの。

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
  SmartHR DS との違い: SmartHR DS の本文は 16px（`M`）で、13.7px（`S`）は「どうしようもない場合」に限る。ここでは
  shadcn のコンポーネントが `text-sm`（14px）で揃っているので本文を `text-sm` にしている。ページ見出しの 24px は
  SmartHR DS の画面タイトル（`XL`）と同じ。書体も SmartHR DS の `system-ui` ではなく LINE Seed JP を使っている。
- 表の数値の列は右揃え（`text-right`）にして、縦に読んだときに桁を比べられるようにする。見出し（`th`）の揃えは
  その列のデータに合わせる
- 字間は Tailwind のスケール（`tracking-tight` / `tracking-wide` / `tracking-wider` / `tracking-widest`
  = 0.1em）から選ぶ。`tracking-[0.1em]` は `tracking-widest` と同じ値なので任意値にしない。日本語の見出し
  などでスケールに無い字間が要るなら、`apps/client/app/globals.css` の `@theme` に `--tracking-*` の
  トークンとして足し（`tracking-<名前>` で使える）、同じ値を画面ごとに書かない
- 【ガード】並べるときの間隔は親の `flex` / `grid` + `gap-*`、コンポーネントの内側は padding で作る。margin
  （`mt-2` / `-mx-4`）と `space-y-*` / `space-x-*` は使えない（中央寄せの `mx-auto` 等 `auto` は可）
- 【ガード】余白（`gap-*` / `p-*`）の大きさは SmartHR DS の余白トークン（16px を `1` とする）に当たる値から選ぶ。
  Tailwind の数字は SmartHR DS の 4 倍で、使えるのは `0` / `1` / `2` / `3` / `4` / `5` / `6` / `8` / `10` / `12` / `16`
  （`gap-1.5` / `p-7` / `gap-9` は `off-scale-spacing` が検出する）。場所ごとの基準は次のとおり【目視】:

  | 場所 | クラス |
  |---|---|
  | セクション同士の間 | `gap-8` |
  | セクション内の要素同士・フォームの項目同士の間 | `gap-6` |
  | 見出しとその内容の間 | `gap-4` |
  | ラベル・説明文と入力欄の間 | `gap-2`（説明文が複数行なら `gap-4`） |
  | アイコン・ステータスとテキストの間 | `gap-1` か `gap-2` |
  | ボタン同士・横に並べた入力欄の間 | `gap-2` か `gap-4` |
  | ページ本文の外周 | `p-8`（モバイルは `px-4 py-6`） |
  | パネル（`Card` 等）の内側 | `p-6`（モバイルは `p-4`） |

  外側ほど大きく、内側ほど小さくする（関係の近い要素ほど近くに置くと、まとまりが読み取れる）。表と違う値に
  するときは、その理由を説明できるようにする
- 正方形は `size-*`（`w-* h-*` を並べない）、条件付きクラスは `cn()`（`@/shared/lib/utils`）で合成する

### 既存のコンポーネントを先に探す

新しい UI を書く前に、既存のコンポーネントで組めないかを確認する。

- `components/ui/`: shadcn のコンポーネント（`Button` / `Card` / `Input` / `Skeleton`）。shadcn CLI の生成物なので
  手で書き換えない。足りないコンポーネントは shadcn CLI で追加する（`components.json` の `style: base-vega` /
  Base UI 前提。Radix 前提の例をそのまま貼らない）。**手書きのコンポーネントをここに置かない**（`components/ui` は
  lint・スタイルガード・knip の対象外なので、置くと規約違反が検出されない）
- `components/patterns/`: 画面パターン（`PageHeader` / `EmptyState` / エラー表示 / NotFound）
- `components/layout/`: ページ枠（`CenteredPage`）・常駐バナー・テーマ切り替え（`ThemeToggle`）
- コンポーネントに渡す `className` は**配置（余白・幅・並び）だけ**に使い、色や文字を上書きしない。見た目の違いは
  `variant` / `size` で表す（例: 削除は `<Button variant="destructive">`、控えめな操作は `variant="ghost"`）

### 状態を必ず作る

- 読み込み中: `Skeleton`（スピナーだけで画面を空にしない）
- 空: `EmptyState`（「無い」ではなく次の行動を示す。`features/tasks/ui/task-list.tsx` が実例）
- エラー: `role="alert"` + `text-destructive`
- 送信中: 対象のボタンを `disabled` にする（`features/tasks/ui/task-list.tsx` の `pendingIds` が実例。行ごとに持つ）
- 値が無い項目（表・定義リスト）: 空欄のままにする。利用者が入力できない項目だけ `-` を `text-muted-foreground` で出す
- 元に戻せない削除: 確認ダイアログを挟む（SmartHR DS の「削除ダイアログ」）。タイトルは「{対象}の削除」、本文は
  「以下の{対象}を削除しますか？　この操作は元に戻せません。」、削除対象の名前を示し、ボタンは右に
  `<Button variant="destructive">` の「削除」、左に「キャンセル」。削除後に元に戻せる操作なら確認は要らない。
  `features/tasks` の削除はまだ確認を挟んでいない

### 文章を中央揃えにしない — 塊は中央、文字は左

日本語は 1 行に入る文字数が多く、中央揃えで折り返すと行頭が毎行ずれて読みにくい。画面の真ん中に置く塊
（空状態・エラー表示・サインイン画面等）は、**塊を中央に置き、中の見出し・本文・アイコン・ボタンはすべて
左揃え**にする。見出しだけ中央に残す形も採らない（見出しもスマホでは折り返す）。

- 【ガード】`text-center`（と style の `textAlign` での中央揃え）は使えない（`scripts/check/client-styles.mjs`
  の `centered-text`）。`flex-col items-center` で中身を中央に並べる形はアイコンの中央寄せ等と区別できないので【目視】
- `components/ui`（shadcn の生成物）はガードの対象外で、Dialog のヘッダー等は `text-center` を持つことがある。
  生成物は書き換えず、呼び出し側の `className` で `text-left` に上書きする
- 書き方: 外側で中央に寄せ（`flex justify-center` / `CenteredPage` / `mx-auto max-w-*`）、内側は `items-start`。
  内側を内容幅に縮める形（`EmptyState`）にすると、短い 1 行でも塊ごと中央に見える
- 文中の `<br />` は中央揃え用の改行であることが多い。左揃えにしたら外す（折り返しと重なって
  「す。」だけの行ができる）
- 中央のままでよいもの: 帳票の表題・数値の欄・写真のキャプション・ファイルのドロップ領域の 1 行案内・
  掲示として正面から読ませる画面（QR の提示画面等）。`text-center` が要るなら、そのファイルを `centered-text` の
  `allowedIn` に足す（許可が PR の差分に出るのでレビューで判断できる）

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

以下は SmartHR DS の「ライティングのガイドライン」と「用字用語」から、このアプリの画面に関わるものを抜き出したもの。

- エラー文言には「事象・原因・対処」を入れる。入りきらないときは原因、対処、事象の順に残す（利用者が知りたいのは直し方）
  - NG: 「タスクの作成に失敗しました」 / OK: 「タスクを追加できませんでした。時間をおいて再度お試しください」
- 敬語を重ねない。「ご確認いただけますようお願いいたします」は「確認してください」、「〜させていただきました」は「〜しました」
- 格助詞を省かない。「項目名変更します」ではなく「項目名を変更します」
- カタカナ語は、先に漢字語で言い換えられないかを考える。開発側の用語（「レコード」「フェッチ」等）を画面に出さない
- 同じものを別の言葉で呼ばない。このアプリは「サインイン」で、「ログイン」と混ぜない

語の形は置き場所で決まる（ボタンとページの `<title>` は【ガード】、ほかはレビューで見る）:

| 置き場所 | 形 | 例 |
|---|---|---|
| 画面タイトル・見出し・項目名 | 名詞。目的語は「の」でつなぐ | 「タスクの追加」 |
| ボタン | 動詞の終止形。「〜する」は省く。目的語は「を」でつなぐ | 「追加」「削除」「タスクを追加」「取り消す」 |
| ダイアログ | タイトル「{対象}の{操作}」と実行ボタン「{操作}」をそろえる | 「タスクの削除」と「削除」 |
| 説明文 | 敬体で動詞まで書く。体言止めにしない | 「上のフォームから最初のタスクを追加できます。」 |
| リンク | 移動先が分かる言葉。「こちら」にしない | 「よくある質問」 |
| ページの `<title>` | 「{画面名}｜{アプリ名}」。全角の縦棒で、前後に空白を入れない | 「タスク｜アプリ名」 |

用字用語（置き換え先が 1 つに決まるものは【ガード】。一覧は `scripts/check/ui-terms.yml`）:

- つくる操作は「追加」（「登録」「作成」は明らかにそちらが合うときだけ）。止める操作は、実行前なら「キャンセル」、
  実行済みなら「取り消す」、実行中なら「中断」
- ボタンは「押す」、リンクは「開く」と書き、「クリック」「タップ」は使わない。外へ出す操作は「書き出す」、
  外から入れる操作は「取り込む」
- 移動先が具体的な場所なら「に」、相対的な位置なら「へ」を使う（「ホームに戻る」「前へ」）
- 数字は半角の算用数字で、3 桁ごとに半角カンマを入れる（「1,000件」）。日付は `YYYY/MM/DD`、時刻は 24 時間制の
  `hh:mm`、期間は「〜」でつなぐ
- 画面の文言では記号を全角にする（「、」「。」「（）」「：」「｜」）。数字・英字の前後に空白を入れない（「PDFファイル」
  「2026年」）。「？」「！」の後に文が続くときは全角の空白を入れる。三点リーダーは「…」を 1 つだけ使う
- 括弧は用途で使い分ける。画面の文言や入力値は「」、ボタン名・項目名は［］、利用者が名前を付けたもの
  （タスクのタイトル等）は【】、補足は（）
- 例を示すときは「例：」と書く（「（例）」にしない）

<!-- textlint-enable -->

`bun run check:ui-copy`（`arch:guards` に含まれる）が client の TS / TSX から日本語の文字列を取り出して
textlint で調べる。語彙は p1ass/textlint-rule-preset-ai-words-ja、誇張と冗長な言い回しは
textlint-ja/textlint-rule-preset-ai-writing、プロダクト独自の語は `scripts/check/ai-words.json`、全角ダッシュは
`scripts/check/ui-copy.mjs` の正規表現が見る。画面の文言だけに当てる規則は `scripts/check/ui-copy.textlintrc.json`
にあり、表記の辞書（`scripts/check/ui-terms.yml`）と和文の空白（textlint-rule-preset-ja-spacing。英数字の前後に
空白を入れない等）を見る。ボタンのラベルと `head` の `meta` の `title` は、置き場所が要るので `ui-copy.mjs` が
AST で見る。コメントは画面に出ないので対象外。Claude Code では TS / TSX を
編集した直後にも `.claude/hooks/on-ts-edit.sh` が整形の後に同じチェックをかけて指摘を返す。

- 指摘されたら文言を直す。その語が画面の用語として必要なときだけ、`.textlintrc.json` の `allows` に足すか
  `scripts/check/ui-terms.yml` の規則を直す（検証器の変更なので、PR 本文の「検証器の変更理由」に理由を書く）
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

SmartHR DS のアクセシビリティのガイドラインから、上に無いものを足す。

- 押せる要素は 24×24px 以上にする（できれば 44×44px）。アイコンだけのボタンは `size="icon"`（36px）以上を使い、
  `icon-xs`（24px）は周りに余白を取れるときだけにする。文中のテキストリンクは対象外
- 入力欄のラベルは常に見える形で置く。プレースホルダーをラベルの代わりにしない（入力を始めると消える）
- エラーは起きた入力欄の近くに、直し方と一緒に出し、文言と入力欄を `aria-describedby` で結び付ける
  （`features/tasks/ui/create-task-form.tsx`）。入力値が原因だと分かるエラーなら、入力欄に `aria-invalid` も付ける
- リンクの文言だけで移動先が分かるようにする（上の「UI 文言の書き方」のリンクの行）
- 見出しと、作業を終えるのに要る入力欄・操作は画面の左側に置く（画面を拡大して使う人は、右側にあるものに気づかないことがある）。
  送信ボタンのように右下が定位置のものは除く

## React パフォーマンスの要点

- **独立した非同期処理は `Promise.all()` で並列化**する。逐次 await のウォーターフォールを作らない。分岐で使わない値の await は分岐の中へ遅延させる。
- **props/state から計算できる値は state に持たない**。effect で setState して同期するのではなく、レンダー中に導出する。
- ユーザー操作起点の副作用は effect ではなく**イベントハンドラ内**で実行する。
- 現在値に依存する setState は**関数型更新**（`setItems(curr => ...)`）にする。stale closure と useCallback の依存増殖を防ぐ。
- 高コストな初期値は `useState(() => ...)` の**遅延初期化**にする。
- プリミティブを返す単純な式を `useMemo` で包まない。
- effect の依存はオブジェクトではなくプリミティブに絞る（`[user]` ではなく `[user.id]`）。
