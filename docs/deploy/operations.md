# 運用ガイド（ロールバック・マイグレーション規律・通知・レート制限）

デプロイ後の「障害に気づけて、戻せる」状態を保つための運用ルール集。
セットアップ手順は [cloudflare-workers.md](./cloudflare-workers.md) を参照。

---

## ロールバック

### 自動ロールバック（smoke 失敗時）

`.github/workflows/deploy.yml` は smoke チェック（`/api/health` + `/`）が失敗すると、
**デプロイ前に動いていた版の commit を再ビルドして再デプロイ**する。戻り先はデプロイの最初に
`SMOKE_BASE_URL` の `/api/health/live` から読む（`commit` が 40 桁の SHA で、main に含まれるときだけ）。
次の場合は戻り先が無いので、手動で対応する:

- 初回デプロイ、または直前から停止していた
- 稼働中の版が main に含まれない、または含まれるかを確かめられなかった（compare API の失敗。ジョブに warning が出る）
- 直前の版を `GIT_SHA` を渡さずに手動デプロイした（`commit` が `dev` になる。`infra:deploy:*` は手元の HEAD を渡す）

`SMOKE_BASE_URL` が未設定なら smoke も自動ロールバックも行わない。
ロールバック後もジョブは赤のまま残るので、原因を修正するまで
次のデプロイ（main への push / タグ作成）は行わないこと。

> **注意**: `wrangler rollback` は使えない。Alchemy のデプロイは上書き型で Cloudflare 側に
> Worker のバージョン履歴が残らないため（実地訓練で確認済み）、ロールバックは常に
> git ref ベース（再ビルド → 再デプロイ）で行う。

### 手動ロールバック

```bash
# 稼働中のインフラの定義の commit（staging / production それぞれの SMOKE_BASE_URL で読む）。自動ロールバックの後は
# アプリ（commit）だけが古く、インフラ（infraCommit）は失敗したデプロイの commit のままなので、commit ではなくこちらを使う
git fetch origin --tags
running_sha=$(curl -fsS "$SMOKE_BASE_URL/api/health/live" | jq -r '.infraCommit // .commit')

# 方法1: 過去の成功した Deploy run を GitHub 上で rerun する（その commit が再デプロイされる）
# rerun はその commit の alchemy.run.ts でデプロイする。稼働中のインフラより後にリソースを足していたら削除されるので、
# 次のコマンドの出力が空のときだけ使う（空でなければ方法2）
git diff <good-sha> "$running_sha" -- alchemy.run.ts
gh run list --workflow Deploy   # 戻りたい run を特定
gh run rerun <run-id>

# 方法2: 古い commit のアプリを別の worktree でビルドし、稼働中のインフラの定義でデプロイする（自動ロールバックと同じ考え方）
# 手元の作業ツリーの alchemy.run.ts と node_modules でデプロイするので、先にその commit に合わせる
# （古い main や作業中のブランチのままだと、その定義でリソースが消える・未リリースのインフラ変更が入る）
git checkout --detach "$running_sha" && bun install --frozen-lockfile
git worktree add --detach ../rollback <good-sha>
(cd ../rollback && bun install --frozen-lockfile && bun run build)
rm -rf apps/client/dist && cp -R ../rollback/apps/client/dist apps/client/dist
# infra:deploy:* はビルドし直して dist を上書きするので使わず、alchemy を直接呼ぶ。
# 手元が稼働中のインフラの commit で、alchemy.run.ts 等にコミットしていない変更が無いときだけデプロイする
# （checkout が失敗して別のブランチのまま・変更を持ち越したままだと、その定義でリソースが消える）
test "$(git rev-parse HEAD)" = "$(git rev-parse "$running_sha")" \
  && test -z "$(git status --porcelain --untracked-files=no)" \
  && GIT_SHA=<good-sha> APP_VERSION=rollback-<good-sha> INFRA_SHA="$running_sha" \
    bunx dotenv -e .env -- bunx alchemy deploy --stage staging   # または production
git worktree remove ../rollback
git checkout -    # 元のブランチに戻る（apps/client/dist は古い版のままなので、次の作業の前にビルドし直す）
```

稼働中の版より古い commit を**新しく**デプロイしようとすると（main 上の古い commit に `vX.Y.Z` タグを打つ等）、
deploy.yml は止まる（`SMOKE_BASE_URL` 設定時。稼働中の版を読めない・稼働中の版が main に無い・compare API が失敗したときは止めない）。巻き戻しは上の方法1（rerun は止めない）か方法2 で行う。

**注意**: ロールバックで戻るのは **Worker のコードだけ**で、DB スキーマは戻らない。
自動ロールバックはインフラの定義（`alchemy.run.ts`）を**今回のデプロイのもの**のまま使う（古い定義でデプロイすると、
今回のリリースで足したリソースが finalize で削除される）。古い commit は別の worktree でビルドし、ビルド成果物
（`apps/client/dist`）だけを差し替えてデプロイする。手動で戻すときも、古い commit を checkout して
`infra:deploy:*` を実行しない（古い `alchemy.run.ts` でデプロイされる）。上の方法2 を使う。

同じ理由で、**Worker のバインディング名・環境変数名の変更と削除も expand / contract で 2 リリースに分ける**
（新しい名前を足すリリース → 旧い名前をやめるリリース）。1 リリースで変えると、ロールバックで旧コードが旧い名前を
読んで失敗する。
下記の expand/contract 規律を守っていれば「旧コード + 新スキーマ」でも動作する。

## DB マイグレーション規律（expand / contract）

deploy.yml は「infra provision → migrate → Worker deploy」の順で実行するため、migrate 成功後に deploy が失敗する・
ロールバックすると、**旧コードが新スキーマの上で動く**時間帯が必ず存在する。
これを安全にするため、マイグレーションは常に後方互換（expand/contract）で書く:

| フェーズ | やってよい変更 | 例 |
|---|---|---|
| **expand**（先行リリース） | 追加のみ。旧コードを壊さない | カラム追加（NULL 許容 or DEFAULT 付き）、テーブル追加、インデックス追加 |
| **migrate**（コード側） | 新旧両対応のコードをデプロイし、新カラムへ書き込み・バックフィル | |
| **contract**（後続リリース） | 旧コードが参照しなくなったものを削除 | カラム削除、NOT NULL 化、リネームの旧名削除 |

**禁止（単一リリースでの破壊的変更）**: カラム/テーブルの削除・リネーム、NOT NULL 追加
（DEFAULT なし）、型変更。これらは必ず expand → contract の 2 リリースに分割する。

`bun run check:migration-safety`（`arch:check` と pre-push に含まれる）がこれらの文を含むマイグレーションを止める。
expand 済みのリリースの後の contract なら、そのファイルの先頭（SQL より前）に `-- migration-safety: allow <理由>` を書く。
このチェックが読むのは drizzle-kit が出すテーブル・カラム・制約・index・enum の変更の形だけで、それ以外（`DO $$ ... $$`・
ブロックコメント・`COLUMN` を省いた `ALTER TABLE`・sequence / policy / role の変更・関数の作成など）は「読まない書き方」として止める。手書きの SQL は別のマイグレーションファイルに分け、同じ印に理由を書く。
0007 以前はガードより前に適用済みの履歴なので対象外（0007 は backfill と SET NOT NULL を 1 本で行っている）。

## 障害通知

このテンプレートには能動的な通知の仕組みが組み込まれていない。実プロジェクト化したら
以下の 3 点を設定すること:

1. **Worker 失敗の検知**: Cloudflare Notifications には **Workers 専用の error rate /
   CPU limit 超過の通知カテゴリが存在しない**（通知カテゴリ一覧を確認済み。最も近い
   `Origin Error Rate Alert` はリバースプロキシ配下の従来型オリジン向けで Workers には
   適用されない）。ダッシュボード設定だけでは検知できないため、Worker の失敗イベントを拾う
   **Tail Worker** を別途デプロイして Slack 等へ転送する。実装時の要点:
   - `outcome=canceled` は検知対象に含めない（大半はクライアントのタブ閉じ/画面遷移で
     サーバー異常ではない。混ぜると通知が「大体無視してよい」ものになる）
   - Worker のハングは CF ランタイム強制終了後も `outcome=ok` のまま `status>=500` を
     返すことがあるため、5xx 判定でも拾う
   - URL はクエリに個人情報が乗りうるので method + pathname のみを転送し、ボディは送らない
2. **GitHub Actions の失敗通知**: deploy.yml の失敗（smoke 失敗 = 本番異常を含む）が
   即座に届くよう、リポジトリの Watch 設定 or Slack の GitHub App（`/github subscribe owner/repo workflows`）を設定。
   Slack webhook を CI から直接使う場合、webhook 用 Secret は **リポジトリレベル** に
   登録すること（Environment を持たない通知ジョブから Environment Secret は空に見え、
   エラーを出さずにスキップされて「設定したのに永遠に届かない」状態になる）
3. **（必要になったら）Logpush**: `observability.enabled: true` のログはダッシュボードで
   閲覧できるが保持が短い。長期保存・検索が必要になったら Environment Secret
   `LOGPUSH_DESTINATION` を設定する（Alchemy が Worker の logpush フラグと LogPushJob を
   作成し R2 や外部集約先に送る。Workers Paid 必須 —
   [Alchemy IaC ガイド](../dev/alchemy-iac.md#オプションリソース環境変数で-opt-in)）

## クライアント（ブラウザ）エラーの通報

SSR 側のエラーは `apps/client/app/server.ts` が observability に出すが、ハイドレーション後に
ブラウザ内で完結するエラー（UI クラッシュ・unhandledrejection 等）はそのままではどこにも届かない。
そこで Sentry 等の第三者サービスを使わず、自オリジンの api-service へ自前で通報している。

- **通報の流れ**: `window.onerror` / `unhandledrejection` のグローバル捕捉、React error boundary
  （`ErrorFallbackContent` の effect から `reportReactError`）、握りつぶすエラーの明示通報
  （`reportHandledError`）→ `POST /api/client-errors` → Cloudflare Workers observability のログ
- **送信側**（`apps/client/shared/lib/report-client-error.ts`）: 送る項目は message / stack /
  パス / バージョン等に限定し、送信前に既知の PII パターンをスクラブする。時間窓でのレート制限と
  同一エラーの抑制もここで行う
- **受け口**（`apps/api-service/src/routes/client-errors/index.ts`）:
  - 認証を要さない（サインイン画面など未認証状態でもエラーは起きる）。`createAuthedApp` /
    `requireAuth` を付けず `createApp()` を直接使う
  - 個人情報を第三者へ出さないため DB には保存せず、observability ログにのみ流す。PII の一次スクラブは
    送信側の責務で、受け口はフィールドの限定と長さの上限による防御に徹する
  - 公開エンドポイントへのログ洪水を防ぐレート制限は、`app.ts` のマウント側で `/api/client-errors/*` に
    付けている

## レート制限

アプリ層の簡易レート制限（`apps/api-service/src/middlewares/rate-limit.ts`）は次の 2 つのパスにだけ
かかっている（`app.ts`）:

- `/api/auth/*` — OAuth エンドポイントの総当たり・過剰アクセス対策
- `/api/client-errors/*` — 認証の無いクライアントエラー通報。ログ洪水対策

どちらも IP（`CF-Connecting-IP`）ごとの固定ウィンドウで、しきい値は共通の
`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`（既定 60 秒あたり 20 リクエスト）。超えると 429 と
`Retry-After` を返す。カウントはパスごとに別々に持つ。

カウントは `app.ts` のモジュールスコープ（isolate 単位）に置いている。Workers はアプリを
リクエストごとに組み立て直すので、ミドルウェアの中にカウントを持たせると毎回 0 から数え直して
一度も制限がかからない（`rate-limit.ts` の `RateLimitStore` 参照）。

ただしカウントは **isolate のメモリにしか持たない**ため、次の限界がある:

- Workers の isolate をまたいで共有されない。リクエストが複数の isolate に振り分けられると
  各 isolate が独立に数えるので、実効レートは isolate 数倍に緩む
- isolate の破棄・再デプロイでカウントが消える
- 上の 2 つのパス以外（`/api/health` など）には何もかからない

したがって、アプリ層の制限は「単一クライアントの暴走を抑える」程度のもので、公開エンドポイント
全体の濫用対策は **Cloudflare 側**で行う:

- カスタムドメイン運用なら Environment Variable `EDGE_RATE_LIMIT_RPM` を設定する
  （Alchemy が WAF に「`/api/*` を IP ごとに N req/分で block」のルールを作成する。
  **zone の http_ratelimit フェーズを専有する**注意点があるため
  [Alchemy IaC ガイド](../dev/alchemy-iac.md#オプションリソース環境変数で-opt-in)を先に読むこと）
- zone を共有していて Alchemy 管理にできない場合は、ダッシュボード > Security > WAF >
  Rate limiting rules で同等のルールを手動作成する
- Workers の課金は「リクエスト数 + CPU 時間」なので、CF 側で止めるのが最も安価
- アプリ層で isolate をまたいだ厳密な制御やユーザー単位の制御が必要になったら、その時点で
  `rate-limit.ts` の保持先を Durable Objects / KV ベースに差し替えることを検討する

## 参照

- [Cloudflare Workers デプロイガイド](./cloudflare-workers.md)
- [wrangler rollback](https://developers.cloudflare.com/workers/wrangler/commands/#rollback)
- [Cloudflare Notifications](https://developers.cloudflare.com/notifications/)
