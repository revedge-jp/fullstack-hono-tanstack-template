# 運用ガイド（ロールバック・マイグレーション規律・通知・レート制限）

デプロイ後の「壊れたことに気づけて、戻せる」状態を保つための運用ルール集。
セットアップ手順は [cloudflare-workers.md](./cloudflare-workers.md) を参照。

---

## ロールバック

### 自動ロールバック（smoke 失敗時）

`.github/workflows/deploy.yml` は smoke チェック（`/api/health` + `/`）が失敗すると、
GitHub の Deployment レコード（environment 付きジョブごとに自動記録される）から
**「最後に成功した Deployment の commit」を解決し、再ビルドして再デプロイ**する。
ロールバック後もジョブは赤のまま残るので、原因を修正するまで
次のデプロイ（main への push / タグ作成）は行わないこと。

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

このテンプレートには能動的な通知経路が組み込まれていない。実プロジェクト化したら
以下の 3 点を設定すること:

1. **Cloudflare Notifications**（ダッシュボード > Notifications）:
   Workers の error rate / CPU limit 超過にアラートを作成し、メール or webhook（Slack）に飛ばす
2. **GitHub Actions の失敗通知**: deploy.yml の失敗（smoke 失敗 = 本番異常を含む）が
   即座に届くよう、リポジトリの Watch 設定 or Slack の GitHub App（`/github subscribe owner/repo workflows`）を設定
3. **（必要になったら）Logpush**: `observability.enabled: true` のログはダッシュボードで
   閲覧できるが保持が短い。長期保存・検索が必要になったら Environment Secret
   `LOGPUSH_DESTINATION` を設定する（Alchemy が Worker の logpush フラグと LogPushJob を
   作成し R2 や外部集約先に送る。Workers Paid 必須 —
   [Alchemy IaC ガイド](../dev/alchemy-iac.md#オプションリソース環境変数で-opt-in)）

## レート制限

アプリ層にはレート制限を実装していない（Better Auth の既定レート制限が `/api/auth/*` に
効くのみ）。公開エンドポイント（`/api/health` など）の濫用対策は **Cloudflare 側**で行う:

- カスタムドメイン運用なら Environment Variable `EDGE_RATE_LIMIT_RPM` を設定する
  （Alchemy が WAF に「`/api/*` を IP ごとに N req/分で block」のルールを作成する。
  **zone の http_ratelimit フェーズを専有する**注意点があるため
  [Alchemy IaC ガイド](../dev/alchemy-iac.md#オプションリソース環境変数で-opt-in)を先に読むこと）
- zone を共有していて Alchemy 管理にできない場合は、ダッシュボード > Security > WAF >
  Rate limiting rules で同等のルールを手動作成する
- Workers の課金は「リクエスト数 + CPU 時間」なので、CF 側で止めるのが最も安価
- アプリ層で細かい制御（ユーザー単位など）が必要になったら、その時点で
  Durable Objects / KV ベースのレートリミッタを検討する

## 参照

- [Cloudflare Workers デプロイガイド](./cloudflare-workers.md)
- [wrangler rollback](https://developers.cloudflare.com/workers/wrangler/commands/#rollback)
- [Cloudflare Notifications](https://developers.cloudflare.com/notifications/)
