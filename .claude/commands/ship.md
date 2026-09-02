現在のブランチの実装を確認してPRを作成します。以下の手順で進めてください。

## 手順

### 1. 差分の取得

```bash
git diff origin/main...HEAD
```

を実行して全差分を取得してください。

### 2. 実装レビュー

取得した差分を以下の観点で確認してください。

**変更前の意図を読む（必須）**
変更された各ファイルについて、変更前のコードが「何をしようとしていたか」を 1〜2 文で言語化してから確認を始めること。

**チェック観点**
- アーキテクチャ: 依存方向 `presentation → application → domain ← infrastructure → integrations` を守っているか
- TypeScript: `as` / `any` の不適切な使用がないか、Zod v4 API を使っているか
- バグ・ロジック: null アクセス、await 忘れ、ROP パターンの正しい使用
- セキュリティ: 認証・認可漏れ、OWASP Top 10
- テスト: 変更に対応するテストが存在するか
- ROP エラー型: Usecase → Presentation で全エラーケースが網羅されているか
- Value Object: `make` / `change` / `reconstitute` の使い分けが正しいか

問題があれば以下の形式で報告する：
```
🔴 [ファイル名:行番号] タイトル
**Root Cause**: なぜ問題なのか
**Impact**: 実行時に何が起きるか
**修正案**: どう直すべきか
```

### 3. レビュー結果の確認

🔴 の問題が見つかった場合は、AskUserQuestion で「上記の問題が見つかりました。修正してからPRを出しますか？それともこのままPRを出しますか？」と確認してください。

🟡 の軽微な指摘のみ、またはレビューOKの場合はそのままPR作成に進んでください。

### 4. PR作成

以下を順番に実行してください：

1. `git log origin/main..HEAD --oneline` でコミット一覧を確認
2. `gh pr create --draft` で **Draft** として PR を作成（レビュー収束前にマージされないようにする。
   Draft の間は auto-merge も merge queue も動かない）

PR のタイトルとボディは差分とコミット履歴から自動生成してください：
- タイトル: 70文字以内、日本語で変更の本質を一言で
- ボディ: `## Summary`（変更内容の箇条書き）+ `## Test plan`（確認手順のチェックリスト）

**関連 issue のクローズキーワード（必須確認）**
この PR が解決する issue があれば、ボディに `Closes #123`（複数なら各行に1つずつ）を必ず入れる。
本文で「親Issue #31」のように**言及するだけ**では GitHub は紐付けも自動クローズもしない。
- issue 番号はブランチ名・コミットメッセージ・ユーザーの指示から拾う。不明なときはユーザーに確認する。
- **その issue の全スコープを本当にこの PR で満たすときだけ** `Closes` を付ける。親 issue が
  他のサブ機能も含む場合は、閉じてよいサブ issue にだけ付け、親には付けない。

**レビュー往復の記録（必須）**
コードレビュー（`/code-review` 等）の指摘対応を行った PR は、ボディ末尾に
`レビュー往復: N周（主な指摘: 一言）` を1行残す。squash マージでコミット単位の
`(コードレビュー指摘)` マーカーは main から消えるため、これが無いとレビュー工数が
後から一切計測できなくなる。往復が無ければ書かない。

### 5. レビュー収束とマージ

PR を作ったら、**worktree の有無に関係なく PR 番号を渡して** `/code-review medium <PR番号>` を回す。
CONFIRMED の指摘が出たら修正して push し、もう 1 周。**CONFIRMED がゼロになった周で終了**
（PLAUSIBLE や整理系だけの周は打ち切ってよい）。依存更新だけの PR でも省かない。

収束したら本文末尾に次の 2 行を書き、Draft を解除して auto-merge を有効にする:

```
レビュー往復: N周（主な指摘: 一言）
レビュー収束: 最終周 CONFIRMED 0
```

```bash
gh pr edit <番号> --body-file <更新した本文>
gh pr ready <番号>
gh pr merge <番号> --auto --squash
```
（merge queue が有効なリポジトリでは方式は queue 側が決めるので「strategy is set by the merge queue」の
警告が出るが失敗ではない。queue が無いリポジトリ（private + Team プラン等）では `--squash` が必須。
`scripts/setup-github.sh` がルールセットを作れていない環境（private + Free プラン）では auto-merge も
無いので、CI 通過後に `gh pr merge <番号> --squash` を手で打つ）

必須チェック `Review converged` が「レビュー収束:」行を検査するので、行が無いと auto-merge は
発火しない。ブランチの最新化は不要（merge queue があれば queue が「main に積んだ状態」で CI を
1 回通してからマージし、無ければマージ後の main の CI が壊れを検出する。`docs/deploy/github-ruleset.md`）。
有効化後は `gh pr view <番号> --json mergeable -q .mergeable` が `MERGEABLE` になることを確認する
（`UNKNOWN` は未計算なので数秒待って再取得。`CONFLICTING` なら rebase して push し直す。
衝突で止まった PR は CI が走らず通知も出ないため、確認せずに放置すると誰も気づかない）。

**例外（手動マージ）**: マイグレーション・auth・決済・検証器(`scripts/check/verifier-paths.txt`)に
触る PR は auto-merge を使わず、ユーザーの確認を待つ。
