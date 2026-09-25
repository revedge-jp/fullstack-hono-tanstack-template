---
paths:
  - "apps/api-service/src/**"
---

# api-service 実装ルール（`apps/api-service/AGENTS.md` の補足）

アーキテクチャの全体像・feature 構造・ROP パターンは `apps/api-service/AGENTS.md` を参照。ここでは
`bun run arch:guards`（`scripts/check/arch-guards.sh`）で機械的に強制される規約と、
そこに載っていない細部の規約をまとめる。

## arch:guards で強制される禁止事項

違反すると CI で落ちる。実装前に把握しておくこと。

- **`throw` 禁止**（`middlewares/`・`config.ts`（起動時 fail-fast 検証）・テストは除外）。エラーは Result チェーンで表現する。
- **`class` / `interface` 禁止**（`.d.ts` / `.gen.ts` は除外）。type エイリアス + ファクトリ関数（`makeXxx`）を使う。
- **`export *` 禁止**（`packages/**` は許可）。バレルは named re-export で書く。
- **`usecase.ts` で `async` / `try-catch` 禁止**。`okAsync().andThen()` チェーンのみ。try-catch が必要な処理は `steps.ts` / infrastructure に委譲する。
- application 層から infrastructure / integrations の直参照禁止（`import type` も不可）。
- application 層で `fetch` / axios / node-fetch の直叩き禁止。
- `features/` 配下（api-service・client とも）で `process.env` 直参照禁止。`config.ts` の `loadConfig()` → container DI 経由。
- `ports.ts` は `features/<feature>/application/ports.ts` にのみ配置可。
- `createAuthedApp()` を使うファイルには `.use(requireAuth(...))` の登録が必須。
- 旧 `@repo/result` API（`result.type ===`）の使用禁止。neverthrow の `result.isOk()` / `result.isErr()` を使う。
- `@hono/zod-validator` の直接 import 禁止。`@app/shared/http/z-validator` の `zValidator` を使う（バリデーション 400 の診断ログ `request_validation_failed` が自動で付く）。

## 命名・型配置

- **DTO**: `XxxInput` と命名し、`application/{action}/validators.ts` で定義・export する。
- **エラー型**: ユースケース意図 + `Error`（例: `CreateTaskError`）。`usecase.ts` のファイル先頭に非 export で定義。
- **ステップ**: ファクトリは `makeXxxStep(deps)`、入出力型は `XxxStepInput` / `XxxStepOutput` をファイル先頭に非 export で置く。
- 同じ型を複数のシグネチャで使う場合はトップレベル型エイリアスを参照する。関数内型定義は、その関数内で完結する一時的な型のみ許容。

## バリデーションの流れ

- application 層のバリデータ（`validateXxx`）は DTO を受け取る。
- domain 層の不変条件検証を呼ぶ際は、**DTO を分解してプリミティブな値を渡す**（domain を DTO から独立させるため）。
- domain の検証関数はプリミティブを受け取る純粋関数として実装する。

## ステップの分割基準

- ステップ数 2〜3 で密結合なら 1 ファイル（`steps.ts`）。4 以上、または責務が明確に異なるなら分割する。

## 外部 SDK（integrations/external）

- 外部サービスの SDK は必ず `src/integrations/external/` に薄いラッパーとして配置。features / middlewares から SDK を直接 import しない。
- ラッパーは `process.env` を参照せず、設定値は呼び出し元（container）からパラメータで受け取る。
- feature 間連携は ports + `integrations/composition/` アダプタ（`apps/api-service/AGENTS.md` の「Feature-to-feature integration」）。adapter を追加したら co-located テストを必ず書く。

## 外部の結果で状態を進めるときは、「確定したこと」を見てから進める

通知の抑止・請求・特典の付与のように、**外部サービスの結果を見て状態を1歩進める**処理は、その結果が
確定したことを確認してから進める。確認より先に進めると、失敗しても状態は戻らず、**本来1回起きるべき
ことが二度と起きない**（警告が永久に届かない・払っていないのに特典が付く）。エラーにならず、テストも
正常系だけなら緑のまま通る。

- **送ったか**: 送信関数は失敗を握り潰して `void` を返さず、届いたかを返す（`fetch` の例外に加え
  非 2xx も失敗）。呼び出し側は届いたときだけ状態を進める（ROP なら `ResultAsync<void, E>` を返し、
  `andThen` の後段で状態を更新する）
- **払ったか**: 決済サービスのステータス遷移は支払いの確定を意味しないことがある（Stripe の
  `past_due→active` は請求書を「回収不能」にしても起き、`trialing→active` は初回請求の確定前に起きる）。
  お金が動く判定にこの遷移を使うなら、なぜそれで足りるのかを検証できる形で書き、書けないなら既知の
  限界として PR に残す
- 反転テストは「失敗の後にもう一度起きる」ことを確かめる（1回目を失敗させ、2回目で届く／付く）

出典: 派生プロダクトでの実例（Slack に届かなくても「通知済み」を保存し、劣化の警告が二度と出なかった／
未払いの顧客の紹介にクレジットが付く処理の流れを作った）。

## integration テストは手書きの後始末を書かない（トランザクション fixture）

`__tests__/integration/*.int.test.ts` は、手書きの `beforeAll` / `afterAll` での `.delete(...)` を
書かず、`test-helpers/transactional-db.ts` の `createTransactionalDb()` を使う。各テストを
BEGIN → ROLLBACK で包むので、テスト中の insert / update / delete は終了時にすべて取り消される。
後始末の書き忘れ・削除順の誤りで「前のテストの残骸で別のテストが落ちる」型の flaky を構造的に防ぐ
（派生プロダクトでは 46 ファイル・約 36,000 行に手書きの後始末が散らばっていた）。

```ts
const { getDb: getTx, end } = createTransactionalDb(process.env.DATABASE_URL ?? "");
// getDb() はテスト本体以外では undefined。非 null アサーションは *.test.ts でのみ許可（ADR-003）
function getDb(): Database {
  return getTx()!;
}

afterAll(async () => {
  await end(); // 接続のクローズは自動登録されない。afterAll の最後で呼ぶ
});

test("...", async () => {
  const db = getDb(); // per-test トランザクション
  const repository = createTasksRepository({ db });
  const ownerId = await seedOwner(db); // シードもこの tx で作る（ROLLBACK で消える）
});
```

- 参照実装: `tasks.int.test.ts` / `activity.int.test.ts`
- **リポジトリが自前で `db.transaction()` を張っても安全**: drizzle の postgres-js アダプタは、tx に
  対する `.transaction(cb)` を SAVEPOINT へマップするので、`getDb()` をそのまま渡してよい
- **制約違反を確かめた後に同じテストでクエリを続けるなら、エラーを起こす処理を
  `getDb().transaction(fn)` で包む**。PostgreSQL はエラーでトランザクション全体を中断状態にし、
  以降のクエリが `25P02 current transaction is aborted` で無関係に落ちる
- **`defaultNow()` 列は1テスト内で同じ値になる**（`now()` はトランザクション開始時刻）。時刻順に
  依存するテストは時刻の列を明示してシードする。任せると全行が同時刻になり、時刻での絞り込みが一度も
  通らないまま緑になる（keyset ページネーションで実際に踏んだ。参照: `tasks.int.test.ts`）
- ファイル全体で共有する読み取り専用のシードだけは `rawDb`（トランザクション外）でファイル直下の
  `beforeAll` に作り、`afterAll` で消してから `end()` を呼ぶ。**テスト本体と `beforeEach` では
  `rawDb` も `getDb().$client` も使わない**。接続が1本（`max: 1`）でトランザクションが握っているため、
  接続待ちのまま原因の読めないタイムアウトになる

## `src/shared/` へロジックを移すと品質ゲートから静かに外れる

`stryker.config.json` の `mutate` は `src/features/*/{domain,application}/**`、
`scripts/check/coverage-threshold.mjs` の既定 TARGET も `src/features/[^/]+/(domain|application)/`。
**feature から `src/shared/` へ関数を移した時点で、そのコードはミューテーションテストとカバレッジ
閾値の両方の対象外になる。** エラーは出ないし CI も緑のままなので、移した本人も気づかない。

**`integrations/composition/` も同じ理由で対象外。** feature 間アダプタもこのグロブに
含まれない。adapter を書く際、**マッピング(pick/rename)を超える実ロジック(`??` による
フォールバック解決、条件分岐、算出等)を adapter 側に置かない**こと — 置いた時点でその分岐は
mutation testing にもカバレッジ閾値にもかからなくなる。解決ロジックは対応する feature の
`application/` 層に置き、adapter はその結果を pick するだけにする。

**外れるのはこの2つだけではない。** `scripts/check/arch-guards.sh` も一部のガード
（application 層からの infrastructure import / `fetch` 直叩き禁止等）を
`find apps/api-service/src/features ...` で走査しており、`src/shared/` を見ていない。
shared へ移したロジックがこれらを破っても `arch:check` は緑のまま通る
（`process.env` 直参照だけは `scripts/check/api-process-env.sh` が `src/` 全体を見ている）。

重複解消のために共有化したら、移した先を `stryker.config.json` の `mutate` に**個別に列挙し**、
`bunx stryker run --mutate '<path>'` で break 90 を満たすことを確認する。あわせて
`commandRunner.command` に `src/shared` のテストが含まれるかも確認する（含まれないと
shared のテストが1件も実行されず、スコアが実際より低く出る）。

## `mutation:diff` はコミットしてから回す（未コミットだと「対象なし」で何もせずに成功する）

`scripts/check/mutation-diff.sh` は差分を `origin/main...HEAD` で取るため、**作業ツリーの
未コミット変更は見えない**。コミット前に実行すると
「domain/application 層に対象の変更が無いため mutation testing をスキップします」と出て
**成功したように終わる**。エラーではないので、通ったつもりで PR を出して CI で初めて落ちる。

- ローカルで確認するときは**必ずコミットしてから**回す。
- `origin/main` が古いと差分が膨らむので、事前に `git fetch origin main` する。

**1行触っただけでもファイル全体が差分スコープに入る。** 変更した行ではなくファイル単位で
mutate されるため、既存コードのテスト不足がそのまま自分の PR の落ちる理由になる。
**domain/application の既存ファイルに手を入れるときは、その周辺のテストを足す作業が
セットで発生しうる**と見込んでおく。

## ミューテーションスコアが低いとき、まず確認するのは「殺せない分岐」

生存ミュータントが特定の行に集中していたら、テストを足す前にその分岐が**挙動として冗長でないか**を
確認する。下流のチェックと同じ入力を弾いているだけのガード節は、消しても観測可能な差が出ないため
**原理的にテストで殺せない**（等価ミュータント）。この場合の正解はテスト追加ではなく**分岐の削除**。

参照: `docs/dev/adding-features.md`（機能追加時に読む規約・参照実装ファイルの案内と、写すときに落としやすい点）/ `docs/dev/coding-standards.md`
