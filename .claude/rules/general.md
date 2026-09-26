# 基本ルール

## コミュニケーション

- すべてのコミュニケーションは日本語で行う。
- コミットメッセージは Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）+ 日本語で書く。
- ブランチ名は `feat/xxx` / `fix/xxx` / `docs/xxx` / `refactor/xxx` のようにプレフィックスを付ける。

## worktree で作業した実装のレビュー・検証

`/code-review` や `/security-review` は **`$CLAUDE_PROJECT_DIR`（メインの作業ディレクトリ）の
現在のブランチ**を対象にする。worktree で実装した内容は**そこには存在しない**ため、そのまま
起動すると**別のブランチが何の警告もなくレビューされる**。エラーにはならず、無関係なファイルへの
指摘が返ってくるだけなので、結果を読むまで気づけない。

**worktree で作業したものをレビューに掛けるときは、対象を明示する。**

- PR があるなら **PR 番号を引数に渡す**（`/review-full <PR番号>`・`/code-review high <PR番号>`）。レビューは CONFIRMED がゼロに
  なる周まで回し、収束の記録を PR 本文に残す（手順と auto-merge は `.claude/commands/ship.md`）。これが最も確実 — レビュー側が
  GitHub から差分を取るので、ローカルのブランチ状態に依存しない
- PR を作る前にレビューしたいなら、**先に PR を作る**（Draft でよい）。「PR前に見たい」と
  「worktree で作業する」は両立しない
- ユーザーが引数なしで `/code-review` を打った場合、**worktree で作業中なら対象がずれている
  可能性を先に伝える**。それを伝えずに結果を報告すると、無関係な指摘を本命のものとして扱ってしまう

### worktree のセットアップはフックが行う — ただし発火を検証してから実装に入る

`EnterWorktree` で作ると WorktreeCreate フックが専用 DB（main の共有 Postgres 内の `wt_<name>`）・`.env`・
`bun install`・マイグレーションまで済ませるが、**発火しない・DB を用意できないことがある**。その状態でも
typecheck / lint / test:unit は通り、`git push` の pre-push で初めて原因の読めない形で落ちる。

- 実装前に `.env` に `WORKTREE_SHARED_DB=1` と `WORKTREE_DB_READY=1` があるか確かめる（`/start-dev` の 3b）。
  無ければ worktree のルートで `bash scripts/agent-worktree-setup.sh`（冪等）
- worktree から `db:up` / `db:down` を実行しない。逆に **main で `db:reset` すると全 worktree の `wt_*` DB が消える**（`db:down` は volume を残す）
- セットアップが volume / コンテナを「別プロジェクト（X）のもの」として DB を飛ばしたら、直すのは worktree
  ではなく **main 側**で、原因は 2 通りある。X が main の以前のディレクトリ名なら（改名・移動した）ディレクトリ名を
  戻す（名前を変えると空の volume で起動する）。そうでなければ main の `.env` の DB コンテナ名・volume 名が
  他プロジェクトと衝突しているので固有にする（`docs/dev/environment-variables.md` の「Docker / インフラ」）。
  どちらも main のチェックアウトに手を入れる作業なのでユーザーに依頼する（`.env` はフックでエージェントから編集できない）
- `.worktreeinclude` で `.env` を worktree に複製しない

フックの動作・衝突検出・`.worktreeinclude` を置かない理由は `.claude/rules/worktree.md`。

### `git diff main` はローカル main の鮮度に依存する（worktree の有無を問わない）

`git diff main` は**ローカルの `main` ブランチ**（`origin/main` ではない）を基準にする。ローカル `main` が
`origin/main` から遅れていると、実装と無関係な差分が大量に含まれ、レビューが実質的に成立しない（エラーには
ならないため、結果を読むまで気づけない）。

レビュー・監査で差分を取るときは `git fetch origin main` してから `git diff origin/main...HEAD` を使う
（`/codex-review` の Step 0 もこの形）。レビュー手順を書くときも `git diff main` と書かない。
PR がある場合は PR 番号を渡す方がより確実。

## 編集方針

- 検証器（一覧は `scripts/check/verifier-paths.txt` が正）の編集は PreToolUse フック
  （`.claude/hooks/protect-verifiers.sh`）で**ユーザー確認**が入り、PR では必須チェックの `Review converged`
  （`review-converged.yml`）が本文の「## 検証器の変更理由」節を要求する。ゲートに引っかかったときの既定はコードを
  直すこと。`.env*` の Read / Edit / Write / Grep はフックが拒否する（Bash での読み書きはフックの対象外なので、`cat .env` 等も使わない。設定の一覧は `.env.example` が正）。

- 既存ファイルのインデント（タブ/スペース、幅）は必ず維持する。変換・混在をしない。
- 文書（AGENTS.md・`.claude/rules`・`.claude/commands`・`docs/`）は `bun run lint:prose` が pre-push と CI でチェックする。
  Claude Code では編集の直後に `.claude/hooks/on-prose-edit.sh` が同じチェックをかけて指摘を返すので、その場で直す。
  比喩に使った動詞や硬い名詞を指摘されたら、何がどうなるかを書く言葉に直す（例は `.claude/rules/client.md` の「UI 文言の書き方」）。
  外部の文言をそのまま引用する箇所だけ `<!-- textlint-disable -->` 〜 `<!-- textlint-enable -->` で囲んでよい。
- コメントは非自明な理由・前提・注意点のみ。行動説明コメントや自明なコメントは書かない。
- 命名は `docs/dev/coding-standards.md` に従う（関数は動詞・変数は名詞・1〜2文字の短名や過度な省略語を避ける。ファイル名は kebab-case — `bun run check:kebab` でチェックされる）。

### `replace_all` は一致件数を事前に数えてから使う

同一ファイル内に構造の似たJSXブロック（例: ローディング/権限なし/通常表示のような複数分岐）が
**異なるインデント深さ**で複数存在する場合、`old_string` に含めた前後の空白・改行が一部の
ブロックにしか一致せず、`replace_all: true` で「全箇所置換したつもり」でも一部の分岐だけ
未置換のまま残ることがある。エディタは対象0件・一部一致でもエラーを出さず成功として返るため、
気づかず次の作業に進んでしまう。

- 複数分岐にまたがる `replace_all` を使う前後で `grep -c` 等により対象文字列の一致件数を数え、
  置換前の件数と置換後の残存件数（0件であるべき）を比べて確認する。
- 分岐ごとにインデント幅が異なりうる箇所では、`old_string` を空白に依存しない最小限の一意な
  部分文字列にするか、分岐ごとに個別の Edit 呼び出しに分ける。

### 数式・設計判断のコメントは、実装完了後にコードと1行ずつ見比べ直す

計算ロジックを実装する際、複数の実装方針を検討してどちらかを採用することがある。この過程で、
検討したが採用しなかった方の説明を先にコメントへ書いてしまい、その後コードの方だけ採用した
方針に書き換えて、**コメントを直し忘れる**ことがある。lint・typecheck・テストはコメントの
内容までは検証しないため、この不一致は自動チェックをすべて通過してしまう。数式や分解ロジックを
含むコメントを書いたら、提出前に**コメント中の各行を実際のコードの該当行と1行ずつ見比べ**る。

### PR の途中で方針を変えたら、前の方針に合わせて書いた記述を全部洗い直す

上のルールは「検討したが採用しなかった案の説明が残る」ケース。**一度採用してコミットし、
その後で捨てた**ケースは別のトリガーで、こちらの方が漏らしやすい — 前の方針の記述は既に
コミット済みで作業ツリーの差分に出てこないため、**手元を見ても気づけない**。

方針転換のコミットを作る前に、**前のコミットで触ったファイルを `git show --stat` で列挙し、
1つずつ開いて記述が新しい方針と合っているかを確認する**。

### 文字列ベースの arch-guard を追加する際は、説明コメントが自身を引っかけないか確認する

禁止文字列を grep するガードを追加した後、変更対象ファイルに旧実装を説明するコメントを書くとき、
そのコメント自体が禁止文字列をリテラルに含むとガードに引っかかる。旧実装の説明はコード文字列
ではなく文言表現で書く。

## ログ出力（api-service / client 共通）

生の `console.*` は使わない（UI コンポーネントも SSR でサーバー描画されるので対象）。`error` / `err` キーは
5xx・未捕捉例外専用。ログを出すコードを書く前に `.claude/rules/logging.md` を読む（出力先・third-party
ロガーの寄せ方・予約キー `failure`・計測の根拠）。

## Git 安全運用

- `--no-verify` を使った commit / push は禁止。lefthook の pre-commit フックや CI チェックのスキップはコード品質を損なう。
- 自動修正系のコマンド（削除を含む）は可能な限りブランチ上で行う。
- 削除系は「検証 → 意図確認 → 段階適用」の順で。指摘のみで即削除しない。

### 使い捨てコミットは commitlint に弾かれる — その直後の `--amend` は別のコミットを書き換える

`mutation:diff` のように**コミット済みの差分しか見ないツール**を途中で回したくて
`git commit -m "wip: 計測用"` のような一時コミットを打つことがある。commitlint（commit-msg
フック）は Conventional Commits 以外を拒否するため、`wip:` や `tmp:` は**コミットが作られない**。
ところが `git commit` の失敗は出力に紛れて気づきにくく、そのまま
`git commit --amend --no-edit` すると、**意図した一時コミットではなく直前の（多くはプッシュ
済みの）コミット**が書き換わる。

- 一時コミットを打つときも**必ず Conventional Commits で書く**（`chore: 計測用の一時コミット` 等）。
- `--amend` の前に `git log --oneline -1` で**書き換え対象を目視確認**する。
- すでに書き換えてしまったら force-push しない。`git reset --soft origin/<branch>` で
  プッシュ済みコミットへ戻し、変更を別コミットとして積む（レビュー対象のコミットが残る）。

## Gemini モデルを利用する場合

モデルを選ぶ・Vertex AI を組み込む前に `.claude/rules/gemini.md` を読む。ユーザーの指示なく、そこに列挙した
モデル以外を使うのは禁止（既定は `gemini-3.5-flash`）。Workers では ADC が使えないので認証方法も決まっている。

## エージェントに渡す権限の「Rule of Two」

エージェントに**本番の資格情報・信頼できない外部入力・外部への送信/書き込み**の 3 つを同時に持たせない。
CI にエージェントを置く・MCP サーバーを足す・本番の値を扱う作業の前に `.claude/rules/agent-permissions.md` を読む。
