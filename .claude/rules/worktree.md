---
paths:
  - ".claude/hooks/worktree-*.sh"
  - "scripts/agent-worktree-setup.sh"
  - "scripts/lib/compose-ownership.sh"
  - "docker-compose.yml"
  - ".worktreeinclude"
---

# worktree のセットアップ（詳細）

要点（実装前の検証・`db:up` / `db:down` の禁止・「別プロジェクトのもの」と判定されたときの対処）は `.claude/rules/general.md` の
「worktree のセットアップはフックが行う — ただし発火を検証してから実装に入る」にあり、常時ロードされる。
ここはフックの動作と、その要点の根拠。

## worktree のセットアップはフックが行う — ただし発火を検証してから実装に入る

`EnterWorktree` で `.claude/worktrees/<name>` を作ると、WorktreeCreate フック
（`.claude/hooks/worktree-create.sh`）が `origin/main` からの分岐・ポート割り当て・main の共有
Postgres 内の専用 DB（`wt_<name>`、dev/test）・`.env`・`bun install`・マイグレーションまで済ませる。
`ExitWorktree` の `remove` では WorktreeRemove フックが DB とポート割り当てを片付ける（ブランチは残す）。

**フックが発火しない・DB を用意できないことがある**（Docker 停止中、使い捨て名の判定、共有コンテナの
名前が他プロジェクトと衝突、`git worktree add` 直打ち）。`.env` が無い状態のまま実装・コミットまで
進んでも `bun run typecheck` / `lint` / `test:unit` は通ってしまい、`dotenv -e .env` も対象ファイルが
無くてもエラーにならないため、**`git push` の pre-push フック（`check-all.sh` の Tests ステップ）で
初めて、原因の読み取れない形で失敗する**。

実装前に `/start-dev` の 3b の検証手順を通す（`.env` に `WORKTREE_SHARED_DB=1` と
`WORKTREE_DB_READY=1` があるか）。無ければ worktree のルートで冪等に復旧する:

```bash
bash scripts/agent-worktree-setup.sh
```

- worktree から `db:up` / `db:down` を実行しない（DB は main の共有コンテナ。compose プロジェクトが
  別になりポートを奪い合う）。逆に **main で `db:reset` すると全 worktree の `wt_*` DB が消える**（`db:down` は volume を残す）
- main の `.env` の DB コンテナ名・volume 名が、このテンプレートから作った他プロジェクトと同じ既定値
  （`app_*`）のままだと衝突する。フックは衝突を検出すると共有 Postgres に触れず DB を飛ばし、
  `db:up` / `db:down` / `db:reset` も止まる（`scripts/lib/compose-ownership.sh`。他プロジェクトの稼働中 DB の
  volume を2つ目の Postgres がマウントする・`db:reset` で消すのを防ぐため）。名前は
  `docs/dev/environment-variables.md` の「Docker / インフラ」に従って固有にする

## `.worktreeinclude` で `.env` を worktree に複製しない

Claude Code の `.worktreeinclude` は gitignore 済みファイルを新 worktree へコピーする仕組みだが、
このリポジトリの `.env` は worktree ごとに**別のポート・別の DB**（共有コンテナ内の `wt_<name>`）を
指す前提で、フックが main の `.env` をコピーしてから worktree 固有の値に書き換えるので不要。置くと、
フックが発火しなかったときに main の `.env` がそのまま使われ、`.env` の有無による未セットアップの
検出もできなくなったうえで、main と同じ DB・ポートを取り合ってテストが互いのデータを書き換える。
