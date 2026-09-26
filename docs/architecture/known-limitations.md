# 既知の制約と対応を見送っているもの

テンプレートのレビューは、見方を変えるたびに新しい指摘を出す。指摘をゼロにすることを目標にすると終わらないので、
このテンプレートは次の 3 つを満たすことを「テンプレートとして直すべきもの」の基準にしている。これに当たらない
指摘は、この文書に理由と対処の仕方を書いて受け入れる。

1. **本番で取り返しのつかないことが起きない**: データ損失・全停止・認証の抜けが起きる手順が無い
2. **ゲートが「検出する」と書いてあるものは実際に検出する**: 文書の主張ごとに、違反を置いて落ちることを確かめる
   テストか自己テストがある（`scripts/check/arch-guards.selftest.sh`・`protect-verifiers.selftest.sh`・各 contract テスト）
3. **写経される参照実装（tasks feature・データ取得・認証の形）が正しい**

派生プロダクトで実際に問題になったものは、この一覧から外してテンプレートを直す（還元する）。

## 運用（本番に出してから決めるもの）

| 項目 | 今の状態 | 必要になったら |
|---|---|---|
| production デプロイの関門 | main に含まれる commit か・稼働中より古くないか（`SMOKE_BASE_URL` を設定し、稼働中の版を読めて compare API が成功したときだけ）しか見ない。staging で成功したかは見ず、`v*` タグの保護も production の承認者も無い | GitHub の ruleset でタグの作成を絞り、production の Environment に required reviewers を付ける |
| 検証器を変える PR のマージ | 必須チェック `Review converged` は PR 本文の記述を見るだけで、PR 側のワークフロー定義で動く。承認数 0・CODEOWNERS 無し | チームで運用するなら CODEOWNERS と `require_code_owner_review` を検証器のパスに付ける（1 人の開発では自分の PR を承認できないので付けていない） |
| DB のロール | アプリとマイグレーションが同じ権限のロールを使う | マイグレーション用の DDL 権限と、アプリ用の DML だけのロールを分ける |
| バックアップ・復元 | 手順を書いていない（PlanetScale の既定のバックアップに任せている） | 復元の手順と PITR の要否を決め、`docs/deploy/operations.md` に書く |
| 秘密情報のローテーション | 手順を書いていない | `BETTER_AUTH_SECRET`（入れ替えると全員サインアウト）・DB のパスワード・API トークンの手順を書く |
| 障害通知 | 能動的な通知は組み込んでいない（`docs/deploy/operations.md` の「障害通知」） | Cloudflare の通知・Logpush の転送先を設定する |
| 古い行の削除 | 期限切れのセッション・検証トークン・activity を消す仕組みが無い | Cron Trigger で定期削除する |
| Logpush の混在 | `LogPushJob` に filter が無く、staging と production が同じアカウントにあると、両方のログが同じ転送先に入る | stage ごとにデータセットか filter を分ける |
| 依存の自動更新 | Renovate の lockFileMaintenance は自動マージ（範囲内の新しい版が staging まで入る） | 本番依存の更新も人が見るなら `automerge: false` にする |

## アプリ（設計の追加が要るもの）

| 項目 | 今の状態 | 必要になったら |
|---|---|---|
| トランザクション境界 | repository はコンテナを組み立てるときに `db` を束ねて作られ、複数の repository をまたいで 1 つのトランザクションを渡す仕組み（`withTransaction` のポート・Outbox）は無い | 原子性が要る最初の feature で、application に `UnitOfWork` のポートを定義し、infrastructure で `db.transaction` を使って実装する。他の feature の infrastructure を import しない（dependency-cruiser の `server-cross-features-*` が止める） |
| タイムアウト後の書き込み | Hono の `timeout` は 504 を返した後もハンドラを止めない。その後の書き込みは続く | Hono の `timeout` はリクエストの signal を abort しないので、打ち切りを知るには timeout で abort する `AbortController` を自前で作ってハンドラに渡す。または冪等キーで再試行に備える |
| エラー応答の形 | `{ ok: false, error }`・zValidator の既定の形・不正な JSON への text/plain の 3 種類がある | client の `toActionResult` は形が違うときに `fallback` を出すので、画面にはエラー文言が出る（固まらない）。形を揃えるなら zValidator の hook と onError で `{ ok: false, error }` に寄せる |
| セッション失効直後の表示 | セッションの取得は 30 秒キャッシュされるので、別のタブでサインアウトした直後の画面遷移では、データ取得の 401 を空の一覧として表示する（`shared/lib/ssr-auth.ts`）。最大 30 秒 | 401 でリダイレクトさせるなら、セッションのキャッシュも一緒に捨てる（捨てないとサインイン画面がキャッシュを見てホームへ戻す） |
| `x-request-id` | SSR 側は受け取った値をそのままログと応答に使う | 形（英数字とハイフン・長さ）を確かめてから使う |
| dev サインイン | 有効にする条件は `NODE_ENV !== "production"` だけ（`NODE_ENV` の既定は production なので、渡し忘れても無効側に倒れる） | 環境変数での明示的な有効化を足す |
| `/api/client-errors` | 認証なしで warn / error のログを出せる（レート制限あり） | サインイン後だけ受け付けるか、error を warn に落とす |

## ゲート・ツール

| 項目 | 今の状態 | 必要になったら |
|---|---|---|
| pre-push の前提 | `origin/main` と DB が要る（文書だけの変更でも）。ZIP から始めて最初に push する前は `git remote add` と `bun run db:up` が要る | 文書だけの変更で Tests を飛ばす判定を足す |
| knip | CI は未使用のファイル・依存・export をコメントするだけで落とさない（落とすのは Unlisted binaries と Unresolved imports だけ）。ローカルの `arch:check` はすべて落とす | CI でもすべて落とす |
| lint の対象外 | ルート直下の `scripts/**`・`alchemy.run.ts`・`dependency-cruiser.config.cjs` は CI の lint / format の対象外 | ルートの oxlint 設定に加える |
| api-service の `test:unit` | ディレクトリを列挙しているので、新しい場所（`src/routes/` 等）に置いたテストは CI で実行されない（ローカルの `bun run test` と pre-push では実行される） | 列挙をやめて除外で指定する |
| カバレッジ | どのテストも import していないファイルは数えない | カバレッジの対象ファイルの一覧を明示する |
| migration journal の順序 | journal 内の `when` の並びだけを見て、本番に適用済みの状態とは比べない | デプロイ前に `__drizzle_migrations` の適用済みの一覧と比べる |

## 既知の上流の挙動

- TanStack Router の `Asset` は、既存のインラインスクリプトを `getAttribute("nonce")` で探す。CSP の nonce をヘッダーで
  送るとブラウザが nonce 属性を隠すので、`head().scripts` に置いたスクリプトはハイドレーション後に差し込み直されて
  2 回実行される。`__root.tsx` のインラインスクリプトは `ScriptOnce` で出している
