# ADR-007: mutation testing を PR の差分ファイルにスコープする

**ステータス**: 採用済み
**日付**: 2026-07-10

---

## コンテキスト

ADR-006（AI 時代の品質戦略）に基づき、api-service の domain/application 層は
mutation testing（Stryker、break threshold 90%）を CI の必須ゲートにしている
（`apps/api-service/stryker.config.json` / `.github/workflows/ci.yml`）。

`stryker.config.json` の `mutate` はリポジトリ全体の対象ファイル
（`src/features/*/domain/**` + `src/features/*/application/**`）を指す。この設定は
feature が増えるたびに対象ファイル数・ミュータント数が単調に増加する。

この問題は本テンプレートから派生した実プロダクトの運用で顕在化した。feature が
3 つまとまって入った時点で対象は 442 ファイル・603 ミュータントに達し、CI の 1 回の
mutation testing 実行が 6〜10 分かかるようになった。この CI ステップは PR への
push のたびにフル実行される（`concurrency: cancel-in-progress: true` で古い実行は
キャンセルされるため累積はしないが、都度フルスキャンし直す）。1 行の変更でも
リポジトリ全体をスキャンするため、実行時間が PR のサイズではなくリポジトリのサイズに
比例して伸び続け、feature が増えるほど開発イテレーション（push → CI 結果待ち）が
遅くなる。テンプレートを起点にしたプロダクトは必ず同じ経路をたどるため、
テンプレート側で予防的に採用する。

Stryker 組み込みの `--incremental`（前回結果をキャッシュし、変更のあった部分だけ
再実行する機能）は既に検討済みで不採用（`stryker.config.json` の
`_comment_incremental` 参照）。理由: `testRunner: "command"`（`bun test` を直接呼ぶ
方式）では Stryker がテストファイルとミュータントを対応付けられず、テストを変更・
追加しても古い Survived/Killed 結果がそのまま再利用される誤動作を実測で確認した
（false negative — 本来 Killed になるべきミュータントが古い Survived のまま
報告され続ける）。

## 決定

**CI では mutation testing を「PR の差分ファイルのみ」にスコープして実行する。**
Stryker の `--incremental`（履歴キャッシュ方式）は使わず、実行のたびに
`git diff origin/main...HEAD` で対象ファイルを新規に算出し、Stryker の `--mutate`
フラグへ渡す（`scripts/check/mutation-diff.sh` / `apps/api-service` の
`mutation:diff` スクリプト）。

- 対象は `stryker.config.json` の `mutate`/除外パターンと同じ基準
  （`domain/**`・`application/**` の `.ts`、`*.test.ts` と
  `application/{service,index,ports}.ts` は除外）で `git diff` の結果をフィルタする。
- 差分に対象ファイルが無ければ mutation testing 自体をスキップする（0 件を
  スキャンして無駄に Stryker を起動しない）。
- 履歴キャッシュを持たないため、`--incremental` を不採用にした理由
  （テスト変更時の stale な Survived/Killed 再利用）はそもそも起こらない。
  毎回のフレッシュな `git diff` が唯一の入力である。
- ローカルでの手動フル監査用に `bun run mutation`（従来どおりリポジトリ全体を
  対象にする、CLAUDE.md に記載のコマンド）は残す。CI からは呼ばなくなるが、
  リグレッションの疑いがあるときや新機能追加直後の全体確認には引き続き使う。

### CI ワークフローの変更点

- `.github/workflows/ci.yml` の `ci` ジョブが呼ぶスクリプトを
  `bun run mutation` → `bun run mutation:diff` に変更。
- 差分算出に `origin/main` との merge-base 比較が必要なため、`ci` ジョブの
  `actions/checkout` を `fetch-depth: 1` → `fetch-depth: 0`（フル履歴）、
  `persist-credentials: false` → `true` に変更した。本リポジトリは 2026-07-10
  時点で 130 commit 程度と小さく、フルクローンのコスト増は無視できる
  （リポジトリが将来大きく育った場合はこの判断を再検討する — 「再検討のトリガー」参照）。
  `persist-credentials: true` は `changes` ジョブが同じ理由で既に採用している前例に倣う
  （`ci` ジョブも push を行わないため、シークレット持ち出しのリスクは限定的）。

## トレードオフ

**捕捉できなくなるもの**: 変更していないファイルに対する間接的なリグレッション
（他ファイルの変更が既存の domain/application ロジックを壊すが、そのファイル自体は
差分に含まれないケース）。ただし、この種のリグレッションは型チェック・
unit テスト・`coverage:check`（domain/application の line coverage 85% 閾値）で
既に一定カバーされており、mutation testing 固有の価値（「新規/変更コードの
テストが本当に分岐・条件を検証しているか」）は差分スコープでも失われない。

**得られるもの**: CI の 1 回の mutation testing 実行時間が、リポジトリ全体の
サイズではなく PR の変更量に比例するようになる。典型的な PR（数ファイルの変更）では
大幅に短縮される。feature 数が今後増えても、個々の PR の CI 待ち時間は悪化しない。

## 代替案と却下理由

| 代替案 | 却下理由 |
|---|---|
| Stryker 組み込み `--incremental` | `testRunner: command` との相性問題で stale な結果を再利用する誤動作を実測済み（既存の `_comment_incremental` で不採用済み） |
| mutation testing を PR では実行せず、main へのマージ後 or 夜間バッチのみにする | 「ブロックしてから merge」という現行の品質ゲート思想（ADR-006）から外れる。壊れたコードが一度 main に入ってから気づく運用になり、手戻りが大きくなる |
| mutation testing を required check から外し informational にする | CI 時間は変わらない（実行はする）ため速度面の解決にならない。ADR-006 の「機械的に止まる安全網」という設計意図とも合わない |
| `mutate` の対象を feature 単位で分割し、変更された feature だけを CI マトリクスで実行する | 差分ファイル方式より粗い（1 ファイルの変更でも feature 全体を再スキャン）。実装も複雑（マトリクス生成ロジックが要る）でメリットが薄い |

## 再検討のトリガー

- リポジトリの commit 数・履歴サイズが増え、`fetch-depth: 0` のフルクローンが
  無視できないコストになった場合 → `fetch-depth` を適切な固定値（例: 200）に
  変更するか、`actions/checkout` の代わりに base ref だけを狙い撃ちで fetch する
  方式に切り替える
- 差分に含まれないファイルのリグレッションが実際に本番で発生し、mutation testing の
  フルスキャンでしか検知できなかったことが判明した場合 → 週次 or 夜間バッチで
  フル `bun run mutation` を別途 CI に足すことを検討する
- `testRunner` を bun test 直接呼び出しから Stryker 公式サポートのランナーに
  移行できた場合 → `--incremental` の再検討（本 ADR とは独立の判断）

## 参照

- [ADR-006](adr-006-ai-era-quality-strategy.md) — mutation testing を含む品質ゲート全体の設計意図
- [quality-gates.md](../dev/quality-gates.md) — 品質ゲートの一覧と閾値
- `apps/api-service/stryker.config.json` — mutate 対象・除外パターン・`_comment_incremental`
- `scripts/check/mutation-diff.sh` — 本 ADR の実装
