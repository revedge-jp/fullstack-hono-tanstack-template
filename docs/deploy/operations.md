# 運用ガイド（ロールバック・マイグレーション規律・通知・レート制限）

デプロイ後の「障害に気づけて、戻せる」状態を保つための運用ルール集。
セットアップ手順は [cloudflare-workers.md](./cloudflare-workers.md) を参照。

---

## ロールバック

### 自動ロールバック（smoke 失敗時）

`.github/workflows/deploy.yml` は smoke チェック（`/api/health` + `/`）が失敗すると、
**デプロイ前に稼働していた commit**（デプロイの最初に `SMOKE_BASE_URL/api/health/live` の `commit` から読む）
**を再ビルドして再デプロイ**する。ロールバック後もジョブは赤のまま残るので、原因を修正するまで
次のデプロイ（main への push / タグ作成）は行わないこと。

- `SMOKE_BASE_URL` が未設定なら smoke 自体を実行しないので、自動ロールバックも無い
- 初回デプロイ・デプロイ前から停止していた・稼働中の版が同じ commit だった場合は、戻り先が無いので
  ジョブがエラーで止まる。下の「手動ロールバック」で対応する
- GitHub の Deployment レコードは戻り先に使わない。workflow_run のジョブが記録する commit はその時点の
  main の先端で、タグを打った commit と一致しないことがあるため

> **注意**: `wrangler rollback` は使えない。Alchemy のデプロイは上書き型で Cloudflare 側に
> Worker のバージョン履歴が残らないため（実地訓練で確認済み）、ロールバックは常に
> git ref ベース（再ビルド → 再デプロイ）で行う。

### 手動ロールバック

```bash
# 方法1: 過去の成功した Deploy run を GitHub 上で rerun する（その commit が再デプロイされる）
gh run list --workflow Deploy   # 戻りたい run を特定
gh run rerun <run-id>

# 方法2: ローカルから任意の commit をデプロイする
git checkout <good-sha>
bun run infra:deploy:staging    # または infra:deploy:production
```

**注意**: ロールバックで戻るのは **Worker のコードだけ**で、DB スキーマは戻らない。
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
