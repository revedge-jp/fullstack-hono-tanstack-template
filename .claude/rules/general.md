# 基本ルール

## コミュニケーション

- すべてのコミュニケーションは日本語で行う。
- コミットメッセージは Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）+ 日本語で書く。
- ブランチ名は `feat/xxx` / `fix/xxx` / `docs/xxx` / `refactor/xxx` のようにプレフィックスを付ける。

## worktree で作業した実装のレビュー・検証

`/code-review` や `/security-review` は **`$CLAUDE_PROJECT_DIR`（メインの作業ディレクトリ）の
現在のブランチ**を対象にする。worktree で実装した内容は**そこには存在しない**ため、そのまま
起動すると**別のブランチが黙ってレビューされる**。エラーにはならず、無関係なファイルへの
指摘が返ってくるだけなので、結果を読むまで気づけない。

**worktree で作業したものをレビューに掛けるときは、対象を明示する。**

- PR があるなら **PR 番号を引数に渡す**（`/code-review high 559`）。これが最も確実 — レビュー側が
  GitHub から差分を取るので、ローカルのブランチ状態に依存しない
- PR を作る前にレビューしたいなら、**先に PR を作る**（Draft でよい）。「PR前に見たい」と
  「worktree で作業する」は両立しない
- ユーザーが引数なしで `/code-review` を打った場合、**worktree で作業中なら対象がずれている
  可能性を先に伝える**。黙って結果を報告すると、無関係な指摘を本命のものとして扱ってしまう

### 新しい worktree では、実装前に `agent-worktree-setup.sh` を必ず手動実行する

`.claude/worktrees/<name>` を新規作成した直後（`EnterWorktree` 経由・`git worktree add` 経由
のどちらでも）、DB 用の `.env` は自動生成されない（`EnterWorktree` 自体が自動でセットアップ
してくれるわけではない）。

`.env` が無い状態のまま実装・コミットまで進んでも `bun run typecheck` / `lint` / `test:unit`
は通ってしまうため気づけない。`dotenv -e .env` は対象ファイルが無くてもエラーにならず、
環境変数を1つも読み込まないまま黙って後続コマンドへ進む。結果、`DATABASE_URL` /
`TEST_DATABASE_URL` が空のまま `drizzle-kit migrate` が走り、**`git push` の pre-push フック
（`check-all.sh` の Tests ステップ）がここで初めて失敗する** — エラーメッセージからは
「`.env` が無いこと」が直接には読み取れないため、原因調査で時間を使いやすい。

`scripts/agent-worktree-setup.sh` が、他の worktree と衝突しないポート・DB コンテナを
自動割り当てして `.env` を作成し、`bun install` から `db:migrate` まで済ませる。
`.claude/worktrees/<name>` 直下に入ったら、実装に着手する前にまずこれを実行する:

```bash
bash scripts/agent-worktree-setup.sh
```

### `git diff main` はローカル main の鮮度に依存する（worktree の有無を問わない）

`code-review` スキルの Step 0 は `git diff main` を使うが、これは**ローカルの `main` ブランチ**
（`origin/main` ではない）を基準にする。ローカル `main` が `origin/main` から遅れていると、
実装と無関係な差分が大量に混ざり、レビューが実質的に成立しない（エラーにはならないため、
結果を読むまで気づけない）。

レビュー・監査の前に `git fetch origin main` してから `git diff origin/main` で差分を確認する。
PR がある場合は PR 番号を渡す方がより確実。

## 編集方針

- 検証器（一覧は `scripts/check/verifier-paths.txt` が正典）の編集は PreToolUse フック
  （`.claude/hooks/protect-verifiers.sh`）で**ユーザー確認**が入り、PR では CI の `verifier-change`
  ジョブが本文の「## 検証器の変更理由」節を要求する。ゲートに引っかかったときの既定はコードを
  直すこと。`.env*` の読み書きはフックが拒否する（設定の正典は `.env.example`）。

- 既存ファイルのインデント（タブ/スペース、幅）は必ず維持する。変換・混在をしない。
- コメントは非自明な理由・前提・注意点のみ。行動説明コメントや自明なコメントは書かない。
- 命名は `docs/dev/coding-standards.md` に従う（関数は動詞・変数は名詞・1〜2文字の短名や過度な省略語を避ける。ファイル名は kebab-case — `bun run check:kebab` で検査される）。

### `replace_all` は一致件数を事前に数えてから使う

同一ファイル内に構造の似たJSXブロック（例: ローディング/権限なし/通常表示のような複数分岐）が
**異なるインデント深さ**で複数存在する場合、`old_string` に含めた前後の空白・改行が一部の
ブロックにしか一致せず、`replace_all: true` で「全箇所置換したつもり」でも一部の分岐だけ
未置換のまま残ることがある。エディタは対象0件・一部一致でもエラーを出さず成功として返るため、
気づかず次の作業に進んでしまう。

- 複数分岐にまたがる `replace_all` を使う前後で `grep -c` 等により対象文字列の一致件数を数え、
  置換前の件数と置換後の残存件数（0件であるべき）を突き合わせて確認する。
- 分岐ごとにインデント幅が異なりうる箇所では、`old_string` を空白に依存しない最小限の一意な
  部分文字列にするか、分岐ごとに個別の Edit 呼び出しに分ける。

### 数式・設計判断のコメントは、実装完了後にコードと1行ずつ照合し直す

計算ロジックを実装する際、複数の実装方針を検討してどちらかを採用することがある。この過程で、
検討したが採用しなかった方の説明を先にコメントへ書いてしまい、その後コードの方だけ採用した
方針に書き換えて、**コメントを直し忘れる**ことがある。lint・typecheck・テストはコメントの
内容までは検証しないため、この不一致は自動チェックをすべて通過してしまう。数式や分解ロジックを
含むコメントを書いたら、提出前に**コメント中の各行を実際のコードの該当行と1行ずつ突き合わせ**る。

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

`apps/client` と `apps/api-service` は**同一の Cloudflare Worker**にビルドされ、ログは同じ
Observability データセットに入る。そのためこの規約は両方に等しく効く。

- **生の `console.*` は使わない**。
  - api-service: `c.get("logger")` / DI された `logger`
  - client のサーバー経路: `shared/lib/server-logger.ts` の `serverLogger`
  - **UI コンポーネントも対象**。SSR 時はサーバーで描画されるため、描画時の `console` は
    そのまま Workers ログに出る（「ブラウザで動くから対象外」は成り立たない）
- **third-party のロガーも同じ経路に寄せる**。console 出力するライブラリを入れるときは、
  差し替えフックが無いか最初に確認すること。既存の対応:
  - Better Auth: `logger` オプションに pino を委譲（`integrations/external/auth.ts` の
    `toBetterAuthLoggerOption`）。未設定だと DB 障害時に SQL 文とバインド値が
    `$metadata.error` に丸ごと載る
  - postgres.js: `onnotice` に pino を委譲（`packages/database/src/index.ts`）。
    未設定だと DB の NOTICE が素の `console.log` に出る
- **`error` / `err` キーは「5xx・未捕捉例外」専用**。Cloudflare はこの2つのキーの値を
  `$metadata.error` に取り込み、ダッシュボードの既定フィルタ `exists($metadata.error)` が
  それを「Errors」として数える。warn 以下（業務上の拒否、fail-open の失敗）でこのキーを使うと
  本物の異常が埋もれる。4xx の理由は `errorCode`、その他は `reason` / `detail` 等でよい。
- 安全網として `@repo/logging` が warn 以下のログの `error` / `err` を `failure` へ退避する。
  **`failure` はその退避先の予約キー**なので別の意味に使わない。Error オブジェクトは `err` に
  載せてよい（pino の既定シリアライザがスタックを直列化するのはこのキーだけで、退避後も形は保たれる）。

### なぜ生の console を禁止するか（実測メモ）

使い捨て Worker を本番アカウントへ一時デプロイし、3レベル×14形状で実測した結果、
Cloudflare の `$metadata.error` の立ち方は**2つの別系統**になる。

- **pino 経由**（数値 `level` を含むオブジェクト）: `error` / `err` キーがあるときだけ立つ。
  `console.log/warn/error` のどれで出したかは無関係。副作用として `$metadata.level` は常に null。
- **生の console**（数値 `level` なし）: `console.error` は**何を渡しても**立つ（生文字列・複数引数・
  JSON文字列・Error インスタンス・`msg` だけのオブジェクト、すべてメッセージ全文が入る）。
  `console.warn` は `error`/`err` があっても立たない。`console.log` は `error`/`err` のときだけ立つ。
  さらに、**文字列**の `level: "error"` を含めると `console.log/warn` でも error 扱いになる。

生の console を残すとこの2系統が混在し、規約を二重に書く羽目になる。出力経路を1本にすれば
規約は上記の1行（`error`/`err` は 5xx 専用）で済む。

## Git 安全運用

- `--no-verify` を使った commit / push は禁止。lefthook の pre-commit フックや CI チェックのスキップはコード品質を損なう。
- 自動修正系のコマンド（削除を含む）は可能な限りブランチ上で行う。
- 削除系は「検証 → 意図確認 → 段階適用」の順で。指摘のみで即削除しない。

### 使い捨てコミットは commitlint に弾かれる — その直後の `--amend` は別のコミットを書き換える

`mutation:diff` のように**コミット済みの差分しか見ないツール**を途中で回したくて
`git commit -m "wip: 計測用"` のような一時コミットを打つことがある。commitlint（commit-msg
フック）は Conventional Commits 以外を拒否するため、`wip:` や `tmp:` は**コミットが作られない**。
ところが `git commit` の失敗は出力に紛れて見落としやすく、そのまま
`git commit --amend --no-edit` すると、**意図した一時コミットではなく直前の（多くはプッシュ
済みの）コミット**が書き換わる。

- 一時コミットを打つときも**必ず Conventional Commits で書く**（`chore: 計測用の一時コミット` 等）。
- `--amend` の前に `git log --oneline -1` で**書き換え対象を目視確認**する。
- すでに書き換えてしまったら force-push しない。`git reset --soft origin/<branch>` で
  プッシュ済みコミットへ戻し、変更を別コミットとして積む（レビュー対象のコミットが残る）。

## Gemini モデルを利用する場合

ユーザーの指示なく、以下以外のモデルを使うのは禁止。

- `gemini-3-flash-preview`
- `gemini-3-pro-preview`

SDK は `@ai-sdk/google-vertex` を使用し、認証は ADC（Application Default Credentials）を使う。API キーは使用しない。

## エージェントに渡す権限の「Rule of Two」

エージェント（Claude Code・CI 上の claude-code-action・MCP サーバー経由の接続）に、次の 3 つを
**同時に**持たせない。信頼できない入力だけでもエージェントは乗っ取られうる（CVE-2026-24887 は
Claude Code の承認プロンプト回避で、前提は「信頼できない内容がコンテキストに入ること」のみ）が、
2026年上期に実証された被害の大きい攻撃（PromptPwnd / GitInject 等の資格情報窃取・不正 push）は
3 つが揃った構成で成立している。1 つ欠けるだけで被害の上限が大きく下がる。

1. **本番の資格情報**（本番 DB 接続、Workers Secrets、デプロイ用トークン、OIDC トークン）
2. **信頼できない外部入力**（第三者が書ける issue / PR 本文、Web ページ、外部 API 応答、ユーザー投稿）
3. **外部への送信・書き込み**（git push、PR 作成、外部 HTTP、メッセージ送信）

- CI 上でエージェントに実装させるワークフロー（issue コメント起動の claude-code-action 等）は
  **置かない**。公開リポジトリでは第三者が issue やコメントを書けるため 2 を排除できず、実装 PR を
  作るには 3（push / PR 作成）が必須で、2 と 3 が常に同居する。実装はローカルの Claude Code で行い、
  CI のエージェントは読み取り専用のレビュー（`codex-review.yml`: `contents: read`、sandbox read-only）
  に限る。`uses:` の SHA ピン留めと `id-token: write` の不在は `arch:guards` が機械的に検査する。
- MCP で本番 DB に接続するときは**読み取り専用の接続**を使う（PlanetScale / BigQuery 等の
  `*_readonly` ツール）。書き込みが必要なら人が SQL を確認して実行する。
- ローカルの Claude Code は `.env` に本番資格情報を置かない前提で動く。本番の値を扱う作業では、
  その間は Web 取得や外部投稿を伴うツールを使わない。
