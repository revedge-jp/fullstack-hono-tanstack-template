# Alchemy による Infrastructure as TypeScript

**ステータス**: 採用済み — `.github/workflows/deploy.yml` のデプロイ本体（実デプロイでの動作検証は進行中）

[Alchemy](https://alchemy.run) は TypeScript ネイティブの IaC ライブラリ。`alchemy.run.ts`（リポジトリルート）で PlanetScale リソース（Database + Role）と Cloudflare リソース（Hyperdrive + Worker）を宣言し、作成・更新・削除を行う。

## 何を解決するか

旧フロー（手動 DB 作成 + wrangler.jsonc の env + `wrangler secret put`）の手作業を排除する：

| 旧 | Alchemy |
|---|---|
| PlanetScale ダッシュボードで DB / ロールを手動作成し接続文字列をコピー | `Database()` + `Role()` が作成し、接続情報はコード内で Hyperdrive へ直結 |
| `wrangler hyperdrive create` を手動実行して id を wrangler.jsonc の `TODO` に貼る | `Hyperdrive()` リソースが作成〜バインドまで自動 |
| マイグレーション用 `DATABASE_URL` を GitHub secret に手動登録 | provision フェーズが GITHUB_ENV へ export（ログはマスク） |
| ADR-002 の「直接続 (5432) 必須」はドキュメント頼み | Role の直接続エンドポイントを構造的に使用（人が port を選ぶ余地がない） |
| secrets は `wrangler secret put` で個別管理 | `alchemy.secret()` で Worker bindings へ注入 |

## CI での実行（deploy.yml）

マイグレーション順序（旧コードが動いているうちにスキーマを揃え、そのあと新コードを出す）を
守るため 2 段実行になっている：

```
① bunx alchemy deploy --stage <target>   # SKIP_WORKER=1: DB / Role / Hyperdrive まで
   └─ DATABASE_URL を GITHUB_ENV へ export（::add-mask:: 済み）
② bun run db:migrate                     # ①が export した URL を使用
③ bunx alchemy deploy --stage <target>   # Worker デプロイ（全リソース reconcile）
```

① は Worker 以降を宣言しないので、`alchemy.run.ts` は ① では `app.finalize()` を呼ばない。finalize は
「state にあるが今回宣言されなかったリソース」を削除するため、呼ぶと稼働中の Worker・カスタムドメイン・
WAF ルールが ② の間消える。宣言から外したリソースの削除は ③ の finalize が行う。

必要な GitHub Environment Secrets / Variables は
[デプロイガイド](../deploy/cloudflare-workers.md#2-github-environments-の設定)を参照。

## ローカルからの実行

> **原則**: 通常運用のデプロイは CI が担う（secrets は GitHub Environments —
> `bash scripts/setup-deploy-env.sh <stage>` で対話式セットアップ、ローカルには保存しない）。
> ローカル実行は初期検証・緊急時用で、資格情報はその場限りの export か
> 一時的な `.env` 記入で渡し、恒常的に残さないこと。

1. **Cloudflare 認証** — `.env` に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
   - API トークンの権限: **Workers Scripts: Edit** + **Hyperdrive: Edit**（Account スコープ）
   - CI（GitHub secrets）と同じトークンを使い回せる。`wrangler login` の OAuth は Alchemy からは参照されない
     （対話式の `alchemy configure` + `alchemy login` でも可だがトークン方式を推奨）
2. **PlanetScale サービストークン**
   - ダッシュボード → Organization settings → Service tokens で発行（DB 作成権限付き）
3. **`.env` に設定**（`.env.example` の Infra セクション参照）
   - `APP_NAME` — Worker / Hyperdrive / DB の命名ベース
   - `ALCHEMY_PASSWORD` — state 内 secrets の暗号化パスワード
   - `ALCHEMY_STATE_TOKEN` — state store の認証トークン（**同じ Cloudflare アカウントの CI と同一の値**）
   - `PLANETSCALE_ORGANIZATION` / `PLANETSCALE_SERVICE_TOKEN_ID` / `PLANETSCALE_SERVICE_TOKEN`
   - `CUSTOM_DOMAIN` / `APP_ORIGIN` / `WORKERS_SUBDOMAIN` — 公開 URL（`BETTER_AUTH_URL` /
     `CORS_ORIGIN`）の解決元。この優先順（詳細は後述の「オプションリソース」）
   - `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（既存）
   - （任意）`EDGE_RATE_LIMIT_RPM` / `LOGPUSH_DESTINATION` — 後述の「オプションリソース」参照

```bash
bun run infra:deploy:staging      # client をビルドして staging をデプロイ（DB がなければ作成）
bun run infra:deploy:production   # production をデプロイ（通常は CI。ローカルからなら production 用アカウントの値だけを入れた env で）
# ローカルからのデプロイは、稼働中の版の /api/health/live の infraCommit を手元の HEAD が含み、alchemy.run.ts 等に
# コミットしていない変更が無いときだけ進む（古い checkout や GitHub Environment にしか無い変数の入れ忘れで、finalize が
# リソースを削除するのを止める）。初回デプロイなど稼働中の版が無いときだけ ALLOW_UNVERIFIED_LOCAL_DEPLOY=1 を付ける
bun run infra:destroy:staging     # staging のリソースを削除

# ローカルでマイグレーションを流したい時: 接続 URL の取り出し口
SHOW_DATABASE_URL=1 bun run infra:deploy:staging
```

命名は staging: `{APP_NAME}-staging`、production: `{APP_NAME}`。DB も同じ命名で stage ごとに
1 つ作成される。同名の既存リソースがあれば `adopt: true` で引き継ぐ（ダッシュボードで手動作成済みの
DB / Hyperdrive からもそのまま移行できる）。

### pr-* stage（PR プレビュー環境）

`--stage pr-<番号>` は PR プレビュー用の特殊 stage（通常は `preview.yml` が管理し、手で叩くことはない）。
staging / production との違い:

- DB は `Database` を新規作成せず、**staging DB（`{APP_NAME}-staging`）の `Branch`** を作る
  （PS-DEV インスタンス、存在時間分の按分課金、スキーマ・データは複製されない）
- Branch の `delete` はデフォルト **true**: `alchemy destroy --stage pr-N` で DB ブランチごと消える
  （staging / production の DB が destroy で消えないのとは逆。使い捨て前提のため）
- `CUSTOM_DOMAIN` / `APP_ORIGIN` は無視され、URL は常に `{APP_NAME}-pr-N.{WORKERS_SUBDOMAIN}.workers.dev`

## 仕組み

- PlanetScale: `Database`（Postgres / PS_5 / Tokyo / arm / `replicas: 0` = シングルノード $5/月）→
  `Role`（`postgres` 継承、TTL なし）の順に作成し、Role の直接続情報（port 5432）を `Hyperdrive` の origin に渡す。
  **`replicas` は必ず明示する** — 未指定だと PlanetScale デフォルトの HA（3ノード = 3倍額）で作られる
- ビルドは既存の `vite build`（`@cloudflare/vite-plugin`）をそのまま使用。Alchemy は
  `apps/client/dist/server/index.js` を `noBundle: true` で（チャンクごと）アップロードし、
  `dist/client` を Assets としてバインドする
- **state は `CloudflareStateStore`**（自アカウントの CF 上に立つ Durable Object）に置き、
  ローカルと CI で共有する。state service（Worker 名 `alchemy-state-service`）は
  **CF アカウントに1つを全プロジェクトで共用**し、内部では app 名 × stage で名前空間分離される。
  したがって `ALCHEMY_STATE_TOKEN` は**アカウント共通のシークレット**（同じアカウントの全プロジェクトに
  同じ値を配る。別アカウントには別の値）、`ALCHEMY_PASSWORD` は **プロジェクト個別**（state 内 secrets の
  暗号化鍵）。権限の境界は下の「state と資格情報の権限境界」
- stage は Alchemy の `--stage` フラグで分離され、state も stage ごとに独立（ただし名前空間の分離で、
  権限の分離ではない。次節）
- **`infra:destroy` は DB を削除しない**: PlanetScale の `Database` / `Role` は `delete: false`
  （デフォルト）のため、destroy 時は state から外れるだけで実体は残る（誤削除防止）。
  本当に消す場合は PlanetScale ダッシュボードから削除する
- **Hyperdrive のクエリキャッシュは切っている**（`caching: { disabled: true }`）。既定の有効のままだと、同じ SELECT を
  最大 60 秒キャッシュから返すので、作った直後の一覧が古い・削除したセッションが返る・`/api/health` の `SELECT 1` が
  DB の障害を隠す、が起きる（ローカルと E2E は Hyperdrive を通らないのでテストでは見つからない）。読み取りの多い画面で
  キャッシュを使いたいなら、キャッシュしてよいクエリだけを別の Hyperdrive に分ける
- **Hyperdrive の `origin_connection_limit` は Cloudflare API 直叩きで是正している**（`15`。
  alchemy 0.93.12 の `HyperdriveProps` にこのプロパティ自体が存在しないため、`Hyperdrive` 作成
  直後に `cfApi.patch(...)` している）。Cloudflare 側のデフォルト値（60）は PlanetScale PS-5
  クラスタの実際の direct 接続上限（約25）を上回っており、この状態だと Hyperdrive が
  「ソフトリミット」（ネットワーク障害時の高可用性確保のため設定値を超えて接続を張ることがある
  仕様）に従って DB 側の接続枠を先に枯渇させ、PlanetScale Console からの緊急接続すら
  張れなくなる。Cloudflare 自身のドキュメントも「Hyperdrive の接続数上限は origin DB の上限より
  低く設定すべき」と明記している。DB の実枠のうち Hyperdrive には一部だけを割り当て、残りは
  PlanetScale 内部プロセス・保守作業（Console 等）用に残す。**クラスタサイズを変えたら「ティア上げ → `SHOW max_connections;` の再測定 →
  `alchemy.run.ts` のこの値を引き上げ」の順で見直すこと**（DB 側の実際の接続上限より確実に
  低く保つ。逆順は接続枯渇障害を招く）。Hyperdrive の接続数は「同時実行中のクエリ数」ではなく
  「プールが保持している温存接続数」なので、利用者数にはほぼ比例しない

## state と資格情報の権限境界（preview を使う前に読む）

alchemy 0.93 の実装（`alchemy/workers/cloudflare-state-store.ts` と `alchemy/lib/state/cloudflare-state-store.js`）で
確かめた事実:

- state サービス（`alchemy-state-service` Worker。workers.dev に公開される）の認可は `ALCHEMY_STATE_TOKEN` との
  一致だけで、アカウント内の全プロジェクト・全 stage の state は 1 つの Durable Object に入っている。どの app / stage を
  読み書きするかはリクエスト本文の `chain` で呼び出し側が決める。**このトークンを持つ実行環境は、同じアカウントの
  すべてのプロジェクト・stage の state を読み・書き換え・消せる**。トークンが同じなら別アカウントの state サービスにも届く
- state 内の secrets は `ALCHEMY_PASSWORD` から scrypt で作った鍵の AES-256-GCM で暗号化される。このテンプレート
  では production DB ロールのパスワード（Hyperdrive の接続情報）、`BETTER_AUTH_SECRET`（漏れるとセッションを
  偽造できる）、`GOOGLE_CLIENT_SECRET`、（設定時）`LOGPUSH_DESTINATION`（R2 のアクセスキー）が入る
- Workers と Hyperdrive を編集できる `CLOUDFLARE_API_TOKEN` があれば、state サービスや production の Worker を
  差し替えられ、production の Hyperdrive を別の Worker に bind して DB に届く（パスワードを知らなくてよい）

したがって、同じアカウントの中では stage もプロジェクトも権限で分かれていない。`ALCHEMY_PASSWORD` を stage ごとに
分けても、書き換え・削除・Hyperdrive 経由の DB アクセスは防げない。

preview（`preview.yml`）は PR のコード（`bun install` の依存スクリプト・build・PR で書き換えられる
`alchemy.run.ts`・migrate）を preview Environment の資格情報で実行する。fork からの PR には secrets が渡らず、
ラベルを付けた PR でしか動かないので外部の第三者は直接は突けないが、エージェントが書いた PR と乗っ取られた
依存パッケージは届く（`.claude/rules/agent-permissions.md` の Rule of Two）。

- **preview を使うプロジェクトが 1 つでもある Cloudflare アカウントには、どのプロジェクトの production も置かない**。
  production 用のアカウントの `ALCHEMY_STATE_TOKEN` と `CLOUDFLARE_API_TOKEN` はそのアカウント専用の値にする
  （同じ値を使うと、アカウントを分けても公開 URL・API 経由で届く）
- PlanetScale も同じ考え方で、**production の DB は staging / preview のトークンが届かない場所に置く**。確実なのは
  production を別の PlanetScale org に置き、その org のトークンを production の Environment にだけ置くこと。
  理由: preview は同じアカウントの staging の state を書き換えられ、次の staging デプロイは staging のトークンで
  その state を reconcile する（宣言に無いエントリは orphan として削除され、Database の `output.name` を差し替えると
  その DB が改名される）。staging のトークンが「既知の制約」の付与（全 DB への read/write/delete）のままだと、
  これで production の DB が消える・改名される。トークンを Environment ごとに別発行するだけでは防げない
  （DB 単位に権限を絞って防げるかは未検証）
- preview ラベルを付けた PR は、push のたびに再デプロイされる。人がコードを読んで信頼できると判断した PR に
  だけ付け、読んでいない push が続くならラベルを外す
- GitHub 側からの 2 つは別の仕組みで塞いでいる:
  - PR がワークフローを足して `environment: production` を参照する → `scripts/setup-deploy-env.sh` が
    staging / production のデプロイ元を main に限る（`deploy.yml` は `workflow_run` で main 上のジョブとして
    動くので止まらない）。既に作った Environment は `bash scripts/setup-deploy-env.sh <stage>` を再実行すると
    制限が入る（secrets の入力は空 Enter で飛ばせる。承認者・待機時間は引き継ぎ、main 以外の既存の許可は
    消さずに一覧を出すので、不要なら手で削除する）。private リポジトリの Free プランなど、デプロイ元の
    制限が使えない環境ではこれが残る
  - 未マージのコミットに `vX.Y.Z` タグを push する → `deploy.yml` の「Verify the commit is on main」が、
    main に含まれないコミットのデプロイを失敗させる

## オプションリソース（環境変数で opt-in）

いずれも **preview（pr-\*）では無視される**。有効化に必要な API トークン権限は
[デプロイガイド](../deploy/cloudflare-workers.md#2-github-environments-の設定)の
`CLOUDFLARE_API_TOKEN` の行を参照。

| 環境変数 | リソース | 内容 |
|---|---|---|
| `CUSTOM_DOMAIN` | `CustomDomain` | Worker へのカスタムドメイン割り当て（例: `app.example.com`）。zone ID はホスト名から自動解決、DNS レコード・TLS 証明書は Cloudflare が自動管理。公開 URL（`BETTER_AUTH_URL` / `CORS_ORIGIN`）もここから導出されるため設定の不一致が起きない。ドメインが Worker に付いた**次のデプロイで** workers.dev の URL を閉じる（workers.dev 経由だと、そのドメインにかけた WAF のレート制限がかからないため。付ける前に閉じると、ドメインの割り当てが失敗したときにどちらの URL からも届かなくなる）。同じホスト名の DNS レコードが zone に既にあると割り当てに失敗するので、先に消しておく。Google OAuth のクライアントに `https://<ドメイン>` と `https://<ドメイン>/api/auth/callback/google` を足してからデプロイする（サインインの URL がドメインに変わるため） |
| `EDGE_RATE_LIMIT_RPM` | `Ruleset`（`http_ratelimit`） | エッジ（WAF）での `/api/*` IP 別レート制限。`CUSTOM_DOMAIN` 必須。無料プラン制約に合わせ RPM を 10 秒窓に換算する。アプリ内 rate-limit ミドルウェア（isolate ローカル）より手前で分散カウントされる |
| `LOGPUSH_DESTINATION` | `Worker.logpush` + `LogPushJob` | Worker trace ログ（console / 例外）の外部転送（dataset: `workers_trace_events`）。**Workers Paid プラン必須** |

**`EDGE_RATE_LIMIT_RPM` の注意**: Alchemy の `Ruleset` は対象 zone の該当フェーズの
entrypoint ruleset を「丸ごと」管理する（宣言したルールで全置換、destroy でフェーズが空になる）。
ルール自体は `http.host` でこのアプリのホストにスコープしているが、**専有は zone 単位**。
同じ zone に手動のレート制限ルールがある場合や、staging / production が同一 zone を
共有する場合は、有効化を 1 stage に限定すること。

誤上書きはデプロイ時のガードで機械的に防いでいる: `alchemy.run.ts` が Worker を更新する前に
zone の既存ルールをチェックし、この stage の目印（`[alchemy:{worker名}]`）を持たないルール
（手動ルール・別 stage のルール）が 1 件でもあれば、**上書きせずエラーで中断**する。

ガードで止まったときに `EDGE_RATE_LIMIT_RPM` を外して再デプロイしてはいけない。Ruleset の削除（変数を外した後の
finalize・`infra:destroy:*`）はフェーズ全体を空にするので、ガードが挙げた管理外のルールも消える。管理外のルールを
別の zone へ移すか削除してからデプロイし直す。`EDGE_RATE_LIMIT_RPM` をやめるときも、先に zone に管理外のルールが
無いことを確かめる。

## Alchemy 管理に「しない」もの

- **GitHub Environments の secrets / variables**: Alchemy の github プロバイダで宣言することも
  できるが採用しない。(1) secret 値を `.env` 経由で渡す必要があり「デプロイ資格情報をローカルの
  ファイルに保存しない」原則（`setup-deploy-env.sh` のヘッダ参照）と衝突する、(2) 値が Alchemy
  state（CF 上の Durable Object）にも暗号化コピーされ、シークレットの置き場所が増える、
  (3) Alchemy 自身を動かす資格情報が先に必要という鶏卵問題で bootstrap を消せない。
  対話式スクリプト（値は GitHub に直行、ディスクに残らない）が引き続き正解
- **Google OAuth クライアント**: Google Cloud コンソールでの手動作成（対応プロバイダなし）
- **Cloudflare Notifications**（アラート設定）: 対応リソースなし。ダッシュボードで設定する
  （[operations.md](../deploy/operations.md) 参照）

スタックが伸びたら同じ `alchemy.run.ts` に足せるもの: `R2Bucket`（ファイルアップロード）、
`KVNamespace`、`Queue`、`DurableObjectNamespace`、`Workflow` などの Cloudflare リソースは
`Worker` の `bindings` に直結できる。Cloudflare 以外も stripe / sentry / upstash / neon / aws
等のプロバイダが同居可能。

## 検証状況 / 既知の制約

- [x] staging の実デプロイ（PlanetScale DB 作成 → Role → Hyperdrive → Worker → migrate → smoke 通過。2026-07-05 検証済み）
- [x] cluster size（`PS_5` + arm → `PS_5_AWS_ARM`）と region slug（`ap-northeast`）は実 API に受理される
- [ ] OAuth ログインの一気通貫（検証時は Google クレデンシャルがプレースホルダーだったため未確認）
- [ ] `wrangler deploy` でデプロイした既存 Worker / 手動作成済み DB の adopt が問題なく動くか
- [ ] オプションリソース（`CUSTOM_DOMAIN` / `EDGE_RATE_LIMIT_RPM` / `LOGPUSH_DESTINATION`）の
  実デプロイ検証（現状は型チェックと Alchemy 実装の API 仕様確認のみ）
- PlanetScale のサービストークンは一覧系 API（databases list / regions）の権限がなくても動く
  （Alchemy は名前指定の create/get しか呼ばない）。必要な付与は org の `create_databases` +
  全 DB への read/write/delete
- named assets binding（`ASSETS`）は任意のプロパティ名の `in` に true を返す RPC プロキシとして
  env に入るため、Hyperdrive 検出は `connectionString` の string 型チェックまで行う
  （`apps/client/shared/lib/hono-app.ts` — Alchemy デプロイで顕在化した実障害）
- Alchemy は v0.x（pre-1.0）。Effect ベースの v2 リライトが進行中で API 変更の可能性あり
