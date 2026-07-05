# 運用ガイド（ロールバック・マイグレーション規律・通知・レート制限）

デプロイ後の「壊れたことに気づけて、戻せる」状態を保つための運用ルール集。
セットアップ手順は [cloudflare-workers.md](./cloudflare-workers.md) を参照。

---

## ロールバック

### 自動ロールバック（smoke 失敗時）

`.github/workflows/deploy.yml` は staging / production ともに、デプロイ直後の smoke チェック
（`/api/health` + `/`）が失敗すると **直前バージョンへ自動ロールバック**する
（`wrangler rollback --yes`）。ロールバック後もジョブは赤のまま残るので、原因を修正するまで
次のデプロイ（main への push / タグ作成）は行わないこと。

### 手動ロールバック

```bash
cd apps/client

# 直前のバージョンに戻す（Worker 名: staging は {APP_NAME}-staging、production は {APP_NAME}）
bunx wrangler rollback --name <worker-name> --message "manual rollback: <理由>"

# 特定バージョンに戻す場合
bunx wrangler deployments list --name <worker-name>   # version-id を確認
bunx wrangler rollback <version-id> --name <worker-name> --message "<理由>"
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
   閲覧できるが保持が短い。長期保存・検索が必要になったら Logpush で R2 や外部集約先に送る

## レート制限

アプリ層にはレート制限を実装していない（Better Auth の既定レート制限が `/api/auth/*` に
効くのみ）。公開エンドポイント（`/api/health` など）の濫用対策は **Cloudflare 側**で行う:

- ダッシュボード > Security > WAF > Rate limiting rules で、たとえば
  「`/api/*` に対し同一 IP から 60 秒に 100 リクエストを超えたら block」を作成する
- Workers の課金は「リクエスト数 + CPU 時間」なので、CF 側で止めるのが最も安価
- アプリ層で細かい制御（ユーザー単位など）が必要になったら、その時点で
  Durable Objects / KV ベースのレートリミッタを検討する

## 参照

- [Cloudflare Workers デプロイガイド](./cloudflare-workers.md)
- [wrangler rollback](https://developers.cloudflare.com/workers/wrangler/commands/#rollback)
- [Cloudflare Notifications](https://developers.cloudflare.com/notifications/)
