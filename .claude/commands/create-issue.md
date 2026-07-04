---
description: 機能追加・修正の親Issueとサブissueを作成します
---

機能追加・修正の親Issueとサブissueを作成します。

## 手順

### Step 1: 実装内容の把握

引数が渡されている場合はそれを実装内容として使います。引数がない場合は AskUserQuestion で「何を実装しますか？」と聞いてください。

実装内容が決まったら、以下のコマンドでリポジトリ情報とラベル一覧を取得してください：

```bash
gh repo view --json owner,name,defaultBranchRef
gh label list --limit 50
```

### Step 2: Issue 構成を設計してユーザーに提案する

実装内容を分析し、以下の観点でIssue構成を設計してください。

**親Issue**: 機能全体の概要・背景・ゴールを記述。実装詳細には踏み込まない。

**サブIssueの分割方針**:

まず変更が必要なレイヤーを特定する：
- `DB` — Drizzle スキーマ変更・マイグレーション（`packages/database/src/schema/`）
- `BE (API)` — api-service の domain / infrastructure / application / presentation 変更
- `FE` — client の features / ui 変更

次に、1つのサブIssueが「1PRでレビューしやすい大きさか」を判断する。以下の場合はさらに分割を検討する：
- 複数の独立したAPI・ユースケースを追加する
- DBスキーマ変更とアプリ実装が混在する
- 画面が複数あって独立して実装できる
- 変更ファイル数が目安20ファイル超になりそう

**分割の目安（適切なサブIssueの大きさ）**:
- 1PRで完結し、レビュアーが1〜2時間でレビューできる
- 前後のサブIssueへの依存が明確で、単独でマージできる
- タスクリスト（チェックボックス）が5〜15個程度

AskUserQuestion で以下の形式で提案し、確認を取ってください：

```
## 提案するIssue構成

**親Issue**: feat: [機能名]
  概要: [1〜2文で]

**サブIssue**:
1. [prefix]: [機能名] - [レイヤー/範囲]
   - 実装内容: [箇条書き2〜3行]
   - 工数感: 少/中/多

2. ...

この構成でよいですか？変更があればお知らせください。
```

### Step 3: Issue を作成する

ユーザーの確認が取れたら、以下の順番で Issue を作成してください。

#### 3-1. 親Issue を作成

```bash
gh issue create \
  --title "[prefix]: [機能名]" \
  --body "$(cat <<'EOF'
## 概要

[機能の目的・ゴールを2〜3段落で]

## 背景

[なぜこの機能が必要か]

## スコープ

[このIssueに含むもの・含まないものを明記]

## サブIssue

<!-- サブIssueを作成後にリンクを追記 -->
EOF
)" \
  --label "[適切なラベル]"
```

作成後、Issue番号を変数に保存：
```bash
PARENT_NUMBER=$(gh issue list --limit 1 --json number -q '.[0].number')
```

#### 3-2. サブIssueを順番に作成

各サブIssueを作成してください。本文は以下のテンプレートを使います：

```bash
gh issue create \
  --title "[prefix]: [親機能名] - [レイヤー/範囲]" \
  --body "$(cat <<'EOF'
## 概要

[このサブIssueで何を実装するかを1〜2文で]

## 背景

親Issue: #[PARENT_NUMBER]

## タスク

### [セクション名]
- [ ] [具体的なタスク1]
- [ ] [具体的なタスク2]
- [ ] ...

## 完了条件

- [ ] `bun run check-all` が通ること
- [ ] [機能固有の確認事項]
EOF
)" \
  --label "[工数ラベル]"
```

作成後、各 Issue 番号を記録しておく。

#### 3-3. サブIssueを親Issueに紐付ける

作成したサブIssueをすべて親Issueのサブissueとして登録する：

```bash
REPO=$(gh repo view --json owner,name -q '.owner.login + "/" + .name')
gh api repos/$REPO/issues/$PARENT_NUMBER/sub_issues \
  --method POST \
  --field sub_issue_id=[サブIssue番号]
```

各サブIssueに対して繰り返す。

### Step 4: 結果を報告する

```bash
gh issue view $PARENT_NUMBER --web 2>/dev/null || gh issue view $PARENT_NUMBER
```

以下の形式で報告してください：

```
## ✅ Issue 作成完了

**親Issue**: #[番号] [タイトル]
  └ #[番号] [サブIssueタイトル]
  └ #[番号] [サブIssueタイトル]
  └ ...

URL: https://github.com/[owner]/[repo]/issues/[番号]
```

---

**注意事項**:
- prefix は `feat` / `fix` / `refactor` / `chore` から選ぶ
- サブIssueのタイトルは「親Issue名 - レイヤー名」の形式を守る（例: `feat: ○○機能 - DBスキーマ変更`）
- ラベルは `実装工数：少` / `実装工数：中` / `実装工数：多` を工数感に応じて付ける
- 実装詳細（コード設計・型定義など）はサブIssueに書き、親Issueには書かない
