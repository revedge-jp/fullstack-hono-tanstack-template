# GitHub Ruleset 設定ガイド

このドキュメントでは、リポジトリのブランチ保護とセキュリティ設定について説明します。

## 概要

GitHub Ruleset は、ブランチ保護ルールの後継機能で、より柔軟で強力なブランチ保護を提供します。このプロジェクトでは `main` ブランチを保護し、コード品質とセキュリティを担保します。

## 適用方法

以下の設定は `./scripts/setup-github.sh` で一括適用できます（冪等なので何度実行しても安全）:

```bash
gh auth login          # 未認証の場合
./scripts/setup-github.sh
```

> [!NOTE]
> **プランによる制約**: Ruleset と auto-merge は public リポジトリまたは GitHub Pro 以上のプランでのみ利用できます。private + Free プランの場合、スクリプトは該当項目をスキップして案内を出します（API はエラーを返さず黙って無視するものもあるため、スクリプトは適用後の実値を確認して報告します）。Secret scanning は private リポジトリでは GitHub Advanced Security が必要です。

## このテンプレートが適用する設定

### Ruleset: `main-branch-protection`

| ルール | 設定 | 効果 |
|--------|------|------|
| **PRマージ必須** | ✅ 有効 | `main` への直接プッシュを禁止。すべての変更はPRを経由 |
| **レビュー承認** | 0名 | 一人開発のため不要。チーム開発時は1名以上に変更推奨 |
| **CIチェック必須** | ✅ 有効 | `CI Pipeline` ジョブが成功しないとマージ不可 |
| **最新ブランチ必須** | ✅ 有効 | baseブランチ（main）と同期済みであることが必要 |
| **フォースプッシュ禁止** | ✅ 有効 | 履歴の改変を防止 |
| **削除禁止** | ✅ 有効 | `main` ブランチの誤削除を防止 |

### merge queue と auto-merge

`main-branch-protection` は **merge queue** を有効にしている（`merge_method: SQUASH`、
`grouping_strategy: ALLGREEN`、最大 5 件バッチ）。「マージ前にブランチを最新化」
（`strict_required_status_checks_policy`）は **無効**で、代わりにキューが「main + キュー内の先行 PR」の
一時ブランチ（`gh-readonly-queue/main/...`）を作り、そこで `CI Pipeline` を 1 回走らせてからマージする。
並行 PR が何本あっても最新化 → CI 再実行の連鎖が起きない。

- CI 側は `.github/workflows/ci.yml` の `merge_group:` トリガーが対応する。**これが無いとキューは
  永久に待つ**。`merge_group` では paths-filter を使わず全ジョブを回す
- PR は Draft で作り、`/code-review` が CONFIRMED ゼロで収束してから `gh pr ready` と
  `gh pr merge --auto --squash` を打つ（`.claude/commands/ship.md`）。`Review converged` ジョブが
  本文の「レビュー収束:」行を検査するので、収束の記録が無い PR は auto-merge が発火しない
- キューに入った後に push すると弾かれる（入れ直し）。Renovate の automerge はキュー対応済み
- マージ後の deploy は `workflow_run`（CI Pipeline 完了）で動くので変更不要

### リポジトリ設定

| 設定 | 値 | 効果 |
|------|-----|------|
| マージ後ブランチ自動削除 | ✅ 有効 | PRマージ後、featureブランチを自動削除 |
| Squash merge | ✅ 有効 | PRタイトル/本文をコミットメッセージに使用 |
| Merge commit | ✅ 有効 | 通常のマージコミットも許可 |
| Rebase merge | ✅ 有効 | リベースマージも許可 |
| Auto merge | ✅ 有効 | 承認後の自動マージが可能 |

### セキュリティ設定

| 設定 | 状態 | 効果 |
|------|------|------|
| Secret scanning | ✅ 有効 | シークレット（APIキー等）の誤コミットを検知 |
| Secret scanning push protection | ✅ 有効 | シークレットを含むプッシュをブロック |
| Dependabot security updates | ✅ 有効 | 脆弱性のある依存関係の自動更新PR作成 |
| Vulnerability alerts | ✅ 有効 | 脆弱性アラートを通知 |

## 設定の変更方法

### レビュー必須人数の変更

チームメンバーが増えた場合、レビュー承認を必須にすることを推奨します。

```bash
# GitHub CLIでログイン
gh auth login

# カレントリポジトリの owner/repo を取得
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')

# Ruleset ID を取得
RULESET_ID=$(gh api "repos/${REPO}/rulesets" --jq '.[] | select(.name == "main-branch-protection") | .id')

# Rulesetの更新（レビュー1名必須に変更）
gh api "repos/${REPO}/rulesets/${RULESET_ID}" --method PUT --input - << 'EOF'
{
  "name": "main-branch-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "CI Pipeline" }
        ]
      }
    }
  ],
  "bypass_actors": []
}
EOF
```

### Web UIでの変更

1. GitHubリポジトリのページにアクセス
2. **Settings** → **Rules** → **Rulesets** を開く
3. `main-branch-protection` をクリック
4. 必要な設定を変更して保存

## 設定の確認

### GitHub CLI

```bash
# Ruleset一覧の確認
gh ruleset list

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
RULESET_ID=$(gh api "repos/${REPO}/rulesets" --jq '.[] | select(.name == "main-branch-protection") | .id')

# Rulesetの詳細確認
gh api "repos/${REPO}/rulesets/${RULESET_ID}" --jq '.rules[] | {type, parameters}'

# リポジトリ設定の確認
gh api "repos/${REPO}" --jq '{
  delete_branch_on_merge: .delete_branch_on_merge,
  allow_squash_merge: .allow_squash_merge,
  allow_auto_merge: .allow_auto_merge,
  security: .security_and_analysis
}'
```

### Web UI

```
https://github.com/{owner}/{repo}/settings/rules
https://github.com/{owner}/{repo}/settings/security_analysis
```

## これにより保証されること

1. **直接プッシュの禁止**: `main` への変更はすべてPRを経由するため、変更履歴が明確
2. **CI必須**: lint, typecheck, tests, build がすべて成功しないとマージ不可
3. **履歴の保全**: フォースプッシュ・削除からブランチを保護
4. **セキュリティ**: シークレットの誤コミット検知、脆弱性アラート

## チーム開発時の推奨設定

チームメンバーが増えた場合、以下の設定変更を推奨します：

| 設定 | 一人開発 | チーム開発（推奨） |
|------|---------|------------------|
| レビュー承認数 | 0名 | 1名以上 |
| 古いレビュー無効化 | ❌ | ✅ |
| スレッド解決必須 | ❌ | ✅ |
| CODEOWNERS必須 | ❌ | ✅（オプション） |

## トラブルシューティング

### PRがマージできない

1. **CIが失敗している**: Actions タブでエラーを確認
2. **ブランチが古い**: `Update branch` ボタンで main と同期
3. **レビューが不足**: 必要なレビュー数を確認（現在は0名）

### Rulesetが適用されない

- Rulesetの `enforcement` が `active` になっているか確認
- `conditions.ref_name.include` に `refs/heads/main` が含まれているか確認

## 関連ドキュメント

- [CI/CD パイプライン](../../.github/workflows/ci.yml) - CIの詳細
- [Cloudflare Workers デプロイガイド](cloudflare-workers.md) - デプロイフローの全体像とシークレット設定
