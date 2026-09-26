# git worktree 運用ガイド

このドキュメントでは、git worktree を使った並行開発のワークフローについて説明します。

**並行開発の worktree は Claude Code の worktree（`EnterWorktree`）を使う**。作成時に WorktreeCreate フックが
ポートと DB（main の共有コンテナ内の `wt_<name>`）を割り当て、`.env`・`bun install`・マイグレーションまで済ませる。

## Claude Code の worktree（`.claude/worktrees/<name>`）

`.claude/settings.json` に登録した2つのフックが作成と破棄を担う。

- **WorktreeCreate**（`.claude/hooks/worktree-create.sh`）: `origin/main` から `claude/<name>` を
  分岐 → CLIENT/API ポートの割り当て → main の共有 Postgres（postgres / postgres-test）内に
  `wt_<name>` DB を作成 → main の `.env` をコピーして worktree 固有の値に書き換え → `bun install` →
  マイグレーション（dev/test）。DB まで用意できたときだけ `.env` に `WORKTREE_DB_READY=1` を書く。
  DB 名は name が英小文字・数字・`_` だけならそのまま `wt_<name>`、`-` などを含む・長いときは
  `wt_<変換した name>_<ハッシュ 6 桁>` になる（`feat-x` と `feat_x` が同じ DB を指さないようにするため）。
  実際の名前は worktree の `.env` の `DATABASE_URL` にある
- **WorktreeRemove**（`.claude/hooks/worktree-remove.sh`）: `git worktree remove` → `wt_<name>` DB の
  DROP → ポート割り当ての解放。ブランチは消さない（未 push の作業を守るため）

### フックの性質（編集するときに読む）

- **WorktreeCreate は置換フック**。設定されていると Claude Code は自前の `git worktree add` を実行せず、
  フックが worktree を作って**絶対パスだけを stdout に出す**ことを期待する。進捗ログや `bun install`
  の出力を stdout に出すと worktree 作成が失敗するので、スクリプトは実 stdout を fd 3 に退避している
- 置換フックなので、途中で異常終了すると「DB の無い worktree」ではなく「worktree が作られない」になる。
  Docker 停止中・main に `.env` が無い・共有コンテナの名前衝突では DB だけ飛ばして成功させる
- フックは **main チェックアウトのコピー**（`$CLAUDE_PROJECT_DIR`）が実行される。設定の読み込みも
  セッション開始時なので、フックを変更したら main を更新して新しいセッションで確認する
- 変数の直後に全角文字を続けるときは `${VAR}` と書く（macOS の bash 3.2 は UTF-8 ロケールで全角文字の
  先頭バイトを変数名の一部と解釈し、unbound variable で落ちる）

### DB を分割する理由と注意

worktree ごとにコンテナを立てる旧方式（スロット方式）は、使い捨ての worktree が増えるたびにコンテナと
volume が積み上がる。共有コンテナ内に DB を1つ切る方式なら増えない。

- worktree から `db:up` / `db:down` を実行しない（compose プロジェクトが別になりポートを奪い合う）。
  `.env` のコンテナ名・volume 名は一意なダミーに書き換えてあるので、誤って実行しても main の
  volume は巻き込まない
- **main で `db:reset` すると全 worktree の `wt_*` DB が消える**（`db:down` は volume を残す）。worktree のルートで
  `bash scripts/agent-worktree-setup.sh` を実行すれば作り直せる
- main の `.env` のコンテナ名・volume 名が、このテンプレートから作った他プロジェクトと同じ既定値
  （`app_postgres` / `app-postgres-data` 等）だと衝突する。フックは既存のコンテナ・volume が別の compose
  プロジェクトの持ち物なら共有 Postgres に触れずに DB を飛ばす（他プロジェクトの稼働中 DB の volume を
  2つ目の Postgres がマウントするとデータが不整合になる）。main の `.env` で固有の値に変えてから復旧する
- `agent-a*` / `wf_*` / `job-*` / `bg-*` の機械生成名（サブエージェント・ワークフロー）は DB を作らない。
  必要なら `CLAUDE_WORKTREE_FULL_SETUP=1`

### 復旧

フックが発火しなかった・DB を飛ばした worktree は、worktree のルートで次を実行する（冪等）:

```bash
bash scripts/agent-worktree-setup.sh
```

旧方式（`.env` の `POSTGRES_CONTAINER_NAME` が `_wt<数字>` で終わる）の worktree はそのまま使える。
`ExitWorktree remove` はこの方式を片付けずに止まり、手順（worktree のルートで `docker compose down -v`
→ `git worktree remove`）を表示する。

## worktree 共通の注意

### ビルド成果物

以下のディレクトリは worktree ごとに独立しているため、競合しません:

- `node_modules/`
- `dist/` / `.output/`（ビルド成果物）
- `.turbo/`

### Git 操作

```bash
# どの worktree からでも全ブランチを操作可能
git fetch origin
git log origin/main

# ただし、別の worktree でチェックアウト中のブランチは
# 現在の worktree ではチェックアウトできない
```

### IDE の設定

**VS Code 等のエディタ**:
- 各 worktree を別ウィンドウで開く
- ワークスペース設定は worktree ごとに独立

**推奨**: メイン worktree に戻る際は、同じウィンドウで「フォルダを開く」

## トラブルシューティング

### Q: worktree が削除できない

Claude Code の worktree は、作ったセッションの中なら `ExitWorktree`（remove）で消す。WorktreeRemove フックが
ポートの登録と `wt_<name>` DB も片付ける。前のセッションで残した worktree（`ExitWorktree` の対象外）は、main の
ルートからフックを直接流す（ディレクトリが既に無くても続きを片付ける）:

```bash
echo '{"worktree_path":"<worktree の絶対パス>"}' | bash .claude/hooks/worktree-remove.sh
```

手で流したときは、未コミット・未追跡の変更か、どのブランチにも乗っていないコミット（detached HEAD・rebase の
途中）が残っていると、フックは内容を表示して止まる（`git worktree remove --force` はそれらを確認なしに消すため）。
確かめたうえで消すなら `WORKTREE_REMOVE_FORCE=1` を付ける。gitignore 対象のファイル（`.env` 等）は確認しない。

共有 DB 方式の worktree を `git worktree remove` で直接消すと、ポートの登録と DB が残る（旧方式の片付けは上の「復旧」）。

### Q: 「already checked out」エラー

同じブランチを複数の worktree でチェックアウトすることはできません。

```bash
# 対処: 別のブランチ名を使用するか、既存の worktree を削除
```

### Q: bun install が遅い

worktree ごとに完全な `node_modules` が必要なため、初回は時間がかかります。
Bun のグローバルキャッシュにより、2回目以降は高速化されます。

### Q: Drizzle のスキーマ変更が反映されない

マイグレーションはスキーマを変更したブランチで 1 回だけ `bun run db:generate` してコミットし、他の worktree は
取り込んだマイグレーションを `bun run db:migrate` で当てる（各 worktree で生成し直すと、同じ変更の
マイグレーションが別名で重複する）。

## 参照

- [Git公式ドキュメント: git-worktree](https://git-scm.com/docs/git-worktree)
- [開発ガイド](development.md)

