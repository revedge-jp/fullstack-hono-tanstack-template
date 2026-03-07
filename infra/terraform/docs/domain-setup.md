# ドメイン設定ガイド

本ガイドでは、ロードバランサーにカスタムドメインを設定し、HTTPSを有効化する手順を説明します。

## 前提条件

- ドメインの所有権があること
- DNS管理権限があること
- Terraformでインフラが既に構築されていること（IPアドレスでアクセス可能な状態）

## 手順

### 1. ロードバランサーのIPアドレスを確認

```bash
cd infra/terraform
terraform output load_balancer_ip
```

出力例: `34.98.111.80`

### 2. DNSにAレコードを設定

ドメインレジストラーまたはDNSプロバイダーで、以下のAレコードを追加します：

| 種類 | ホスト名 | 値 | TTL |
|------|---------|-----|-----|
| A | `@` または `example.com` | `34.98.111.80` (ロードバランサーのIP) | 300以上 |

**例（Cloudflareの場合）:**
- タイプ: `A`
- 名前: `@` または `example.com`
- IPv4アドレス: `34.98.111.80`
- プロキシ: オフ（DNSのみモード）

**注意:**
- サブドメイン（例: `api.example.com`）を使用する場合も同様にAレコードを設定します
- DNSの伝播には数分〜数時間かかることがあります
- `dig example.com` コマンドで反映を確認できます

### 3. Terraform変数を設定

`terraform.tfvars` ファイル（または環境別の `stg.tfvars` / `prod.tfvars`）に以下を追加：

```hcl
# HTTPSを有効化
enable_ssl = true

# 使用するドメイン（完全修飾ドメイン名）
load_balancer_domain = "example.com"
```

**例 (`terraform.tfvars`):**
```hcl
project_id = "your-project-id"
region     = "asia-northeast1"
db_password = "your-secure-password"

# ドメイン設定
enable_ssl = true
load_balancer_domain = "yourdomain.com"
```

### 4. Terraformを適用

```bash
cd infra/terraform
terraform plan  # 変更内容を確認
terraform apply  # 適用
```

これにより以下が作成されます：
- Google管理SSL証明書（`google_compute_managed_ssl_certificate`）
- HTTPSプロキシ（`google_compute_target_https_proxy`）
- HTTPS転送ルール（`google_compute_global_forwarding_rule`）

### 5. SSL証明書のプロビジョニングを待つ

Google管理SSL証明書は自動的に発行されますが、**最大15分程度**かかります。

証明書の状態を確認：

```bash
# SSL証明書の状態を確認
gcloud compute ssl-certificates list \
  --project=<your-project-id> \
  --filter="name:ax-lb-ssl-cert"

# 詳細を確認
gcloud compute ssl-certificates describe ax-lb-ssl-cert \
  --project=<your-project-id> \
  --global
```

**証明書の状態:**
- `PROVISIONING`: 発行中（待機）
- `ACTIVE`: 有効（使用可能）
- `FAILED`: 失敗（DNS設定を確認）

### 6. 動作確認

証明書が `ACTIVE` になったら、以下でアクセスできます：

```bash
# HTTPSでアクセス
curl https://yourdomain.com

# またはブラウザで
open https://yourdomain.com
```

**確認ポイント:**
- ✅ HTTPSでアクセスできる
- ✅ SSL証明書が正しく表示される
- ✅ `/api/*` パスがserverにルーティングされる
- ✅ その他のパスがclientにルーティングされる

## トラブルシューティング

### SSL証明書が PROVISIONING のまま

**原因:**
- DNSレコードが正しく設定されていない
- DNSの伝播が完了していない

**対応:**
1. DNS設定を確認
   ```bash
   dig yourdomain.com
   # または
   nslookup yourdomain.com
   ```
   - ロードバランサーのIPアドレスが返ってくることを確認

2. DNSの伝播を待つ（最大24時間、通常は数分〜数時間）

3. Terraformを再適用
   ```bash
   terraform apply -replace=google_compute_managed_ssl_certificate.main[0]
   ```

### SSL証明書が FAILED になる

**原因:**
- DNSレコードが正しく設定されていない
- ドメインの所有権確認に失敗

**対応:**
1. DNS設定を再確認（上記参照）
2. SSL証明書を削除して再作成
   ```bash
   gcloud compute ssl-certificates delete ax-lb-ssl-cert \
     --project=<your-project-id> \
     --global
   terraform apply
   ```

### 証明書は有効だがアクセスできない

**原因:**
- ロードバランサーのプロビジョニングが完了していない
- ファイアウォールルールの問題

**対応:**
1. ロードバランサーの状態を確認
   ```bash
   gcloud compute forwarding-rules list \
     --project=<your-project-id> \
     --global
   ```

2. ログを確認
   ```bash
   gcloud logging read "resource.type=load_balancer" \
     --project=<your-project-id> \
     --limit=50
   ```

### HTTPからHTTPSへのリダイレクト設定

現在の設定では、HTTPとHTTPSの両方が有効です。HTTPからHTTPSへの自動リダイレクトを設定する場合は、URLマップにリダイレクト設定を追加する必要があります。

**注意:** テンプレートではリダイレクト設定は含まれていません。必要に応じて `load-balancer.tf` をカスタマイズしてください。

## 複数ドメインの設定

複数のドメイン（例: `example.com` と `www.example.com`）を使用する場合：

1. DNSに複数のAレコードを設定
2. `load_balancer_domain` に複数のドメインを指定（カンマ区切り）または、複数のSSL証明書リソースを作成

現在のテンプレートは単一ドメインのみ対応しています。複数ドメインが必要な場合は、Terraformコードのカスタマイズが必要です。

## ロールバック

HTTPSを無効化する場合：

```hcl
# terraform.tfvars
enable_ssl = false
load_balancer_domain = ""
```

```bash
terraform apply
```

これにより、HTTPのみのアクセスに戻ります。

## 参考リンク

- [Google Cloud Load Balancer ドキュメント](https://cloud.google.com/load-balancing/docs/)
- [Google管理SSL証明書](https://cloud.google.com/load-balancing/docs/ssl-certificates/google-managed-certs)
- [DNS設定ガイド](https://cloud.google.com/dns/docs/)

