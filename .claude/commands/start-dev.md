これから新しい開発を始めます。以下の手順で進めてください。

## 手順

### 1. 実装内容の確認

AskUserQuestion ツールを使って「何を実装しますか？」とユーザーに聞いてください。

### 2. ブランチ名の提案

ユーザーの回答をもとに、以下のプレフィックス規則でブランチ名を提案してください：

- 新機能: `feat/<kebab-case-description>`
- バグ修正: `fix/<kebab-case-description>`
- リファクタリング: `refactor/<kebab-case-description>`
- その他の作業: `chore/<kebab-case-description>`

ブランチ名は英語の kebab-case で、短く明確に。提案したブランチ名でよいか AskUserQuestion で確認してください。

### 3. 作業環境の選択

ユーザーが明示的に「worktree」と指示した場合（本人の発言・CLAUDE.md・メモリ経由）、または既に
`.claude/worktrees/<name>` の中にいる場合は 3b に進む。それ以外は 3a（現在のチェックアウトでそのまま
作業）を選ぶ。

### 3a. ブランチ作成と環境セットアップ（通常）

1. `git checkout -b <branch-name>` でブランチを作成
2. `bun run start-from-main` で main と同期・依存関係更新・DB セットアップ

### 3b. worktree での作業

Claude Code の worktree（`.claude/worktrees/<name>`）は `EnterWorktree` 時に **WorktreeCreate フック**
（`.claude/hooks/worktree-create.sh`）が自動でセットアップする: `origin/main` から分岐、空きポートの
割り当て、main の共有 Postgres コンテナ内に専用 DB（`wt_<name>`、dev/test 両方）を作成、`.env` 生成、
`bun install`、マイグレーション適用まで。worktree ごとにコンテナや volume は増えない。

1. まだ worktree に入っていなければ `EnterWorktree` を `name: <kebab-case-slug>` で実行
   （`.claude/worktrees/<slug>` が作られ、ブランチは `claude/<slug>`）
2. 規約（`feat/`|`fix/`|`refactor/`|`chore/` + kebab-case）に合わせて `git branch -m <branch-name>` でリネーム
3. **フックが済ませた作業を検証する**（フックが発火しないことがある。不足があれば復旧する）:
   ```bash
   test -f .env && echo ".env: OK" || echo ".env: MISSING"
   grep -E '^(CLIENT_PORT|API_PORT|DATABASE_URL|WORKTREE_SHARED_DB|WORKTREE_DB_READY)=' .env
   git fetch -q origin main && echo "behind origin/main: $(git rev-list --count HEAD..origin/main)"
   ```
   - `.env` が無い・`WORKTREE_SHARED_DB=1` が無い → フック未発火
   - `WORKTREE_DB_READY=1` が無い → フックは発火したが DB を用意できていない（Docker 停止中・使い捨て名
     判定・共有コンテナの名前衝突・マイグレーション失敗）

   どちらも worktree のルートで `bash scripts/agent-worktree-setup.sh`（フックを冪等に再実行し、名前に
   関わらず DB も作るラッパー）を実行する。それでも `WORKTREE_DB_READY=1` にならなければ出力を
   ユーザーに見せて止まる。
   `behind origin/main` が 0 でなければ `git merge origin/main` で取り込む（`git reset --hard` は使わない）。
   `git checkout -b` と `bun run start-from-main` は worktree では実行しない（フックが済ませた作業の
   二重実行になり、`start-from-main` は `git reset --hard` を含む）。
4. `bun run dev` で開発サーバーを起動（worktree 専用ポートで待受）。**この worktree から
   `db:up` / `db:down` を実行しない**（DB は main の共有コンテナ。compose プロジェクトが別になり
   ポートを奪い合う）
5. 作業終了時は `ExitWorktree`（作業を残すなら `keep`、不要なら `remove`）。`remove` は
   WorktreeRemove フックが DB とポート割り当てまで片付ける（ブランチは残る）

**注意**: `EnterWorktree` 実行後は、Read/Edit/Write の `file_path` と Bash コマンド中の絶対パス
（`cd` を含む）に、必ず worktree の絶対パス（`.claude/worktrees/<slug>/...`）を使うこと。元リポジトリの
絶対パスを使い回すと、typecheck/lint/test が通るにもかかわらず元のチェックアウトを編集してしまう。
