---
paths:
  - "apps/api-service/src/**"
---

# api-service 実装ルール（CLAUDE.md の補足）

アーキテクチャの全体像・feature 構造・ROP パターンは CLAUDE.md を参照。ここでは
`bun run arch:guards`（`scripts/check/arch-guards.sh`）で機械的に強制される規約と、
CLAUDE.md に載っていない細部の規約をまとめる。

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
- feature 間連携は ports + `integrations/composition/` アダプタ（CLAUDE.md 参照）。adapter を追加したら co-located テストを必ず書く。

## `src/shared/` へロジックを移すと品質ゲートから静かに外れる

`stryker.config.json` の `mutate` は `src/features/*/{domain,application}/**`、
`scripts/check/coverage-threshold.mjs` の既定 TARGET も `src/features/[^/]+/(domain|application)/`。
**feature から `src/shared/` へ関数を移した瞬間、そのコードはミューテーションテストとカバレッジ
閾値の両方の対象外になる。** エラーは出ないし CI も緑のままなので、移した本人も気づかない。

**`integrations/composition/` も同じ理由で対象外。** feature 間アダプタもこのグロブに
含まれない。adapter を書く際、**マッピング(pick/rename)を超える実ロジック(`??` による
フォールバック解決、条件分岐、算出等)を adapter 側に置かない**こと — 置いた瞬間その分岐は
mutation testing にもカバレッジ閾値にもかからなくなる。解決ロジックは対応する feature の
`application/` 層に置き、adapter はその結果を pick するだけにする。

**外れるのはこの2つだけではない。** `scripts/check/arch-guards.sh` も一部のガード
（`process.env` 直参照の禁止、application 層からの infrastructure import / `fetch` 直叩き禁止等）を
`find apps/api-service/src/features ...` で走査しており、`src/shared/` を見ていない。
`process.env` を持ったまま shared へ移すと `arch:check` は緑のまま通り、Workers では
`process.env` がローカルの Bun と同じようには埋まらないため、**本番でだけ既定値側の分岐に
静かに落ちる**（フラグが off 扱い、上限値が `NaN` 等）。

重複解消のために共有化したら、移した先を `stryker.config.json` の `mutate` に**個別に列挙し**、
`bunx stryker run --mutate '<path>'` で break 90 を満たすことを確認する。あわせて
`commandRunner.command` に `src/shared` のテストが含まれるかも確認する（含まれないと
shared のテストが1件も走らず、スコアが実力より大幅に低く出る）。

## `mutation:diff` はコミットしてから回す（未コミットだと「対象なし」で素通りする）

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

## ミューテーションスコアが低いとき、まず疑うのは「殺せない分岐」

生存ミュータントが特定の行に集中していたら、テストを足す前にその分岐が**挙動として冗長でないか**を
確認する。下流のチェックと同じ入力を弾いているだけのガード節は、消しても観測可能な差が出ないため
**原理的にテストで殺せない**（等価ミュータント）。この場合の正解はテスト追加ではなく**分岐の削除**。

参照: `docs/dev/adding-features.md`（実装例）/ `docs/dev/coding-standards.md`
