# pgAdmin（データベース管理ツール）

開発環境で PostgreSQL の中身をブラウザから確認・操作できる GUI ツールです。

## 概要

- **pgAdmin 4**: PostgreSQL 用のオープンソース管理ツール
- `docker-compose.yml` に含まれており、`bun run db:up` で postgres と一緒に起動
- `SERVER_MODE=False`（デスクトップモード）のため、ログイン画面なしで利用可能

## 起動・停止

```bash
# 起動（postgres + pgAdmin）
bun run db:up

# 停止
bun run db:down
```

pgAdmin は postgres の healthcheck 完了後に自動起動します（`depends_on` + `service_healthy`）。

## アクセス

ブラウザで以下にアクセス:

```
http://localhost:5050
```

## 初回セットアップ

初回アクセス時にマスターパスワードの設定とサーバー登録が必要です。

### 1. マスターパスワード設定

起動直後にマスターパスワードの設定ダイアログが表示されます。任意のパスワードを入力して「OK」をクリックしてください。

### 2. サーバー登録

1. ダッシュボードの「Add New Server」をクリック
2. **General** タブ:
   - Name: 任意の名前（例: `local`）
3. **Connection** タブ:

   | 項目 | 値 |
   |------|------|
   | Host name/address | `postgres` |
   | Port | `5432` |
   | Maintenance database | `postgres` |
   | Username | `postgres` |
   | Password | `postgres` |

4. 「Save」をクリック

サーバー登録情報は `pgadmin-data` ボリュームに保存されるため、2回目以降の登録は不要です。

## テーブルの確認方法

サーバー登録後、左のツリーから以下の順に展開するとテーブル一覧を確認できます:

```
Servers > local > Databases > app_db > Schemas > public > Tables
```

## よく使う操作

### テーブルのデータを閲覧

1. テーブルを右クリック → 「View/Edit Data」 → 「All Rows」
2. データがグリッド表示される

### SQL クエリの実行

1. 上部メニューの「Tools」 → 「Query Tool」
2. SQL を入力して実行（`F5` または再生ボタン）

### テーブル定義の確認

1. テーブルを選択
2. 右パネルの「Properties」タブでカラム定義を確認
3. 「SQL」タブで CREATE TABLE 文を確認

## Docker Compose 設定

```yaml
pgadmin:
  image: dpage/pgadmin4:latest
  container_name: ax_saas_pgadmin
  restart: unless-stopped
  environment:
    PGADMIN_DEFAULT_EMAIL: admin@example.com
    PGADMIN_DEFAULT_PASSWORD: admin
    PGADMIN_CONFIG_SERVER_MODE: "False"
  ports:
    - "5050:80"
  volumes:
    - pgadmin-data:/var/lib/pgadmin
  depends_on:
    postgres:
      condition: service_healthy
```

| 環境変数 | 説明 |
|----------|------|
| `PGADMIN_DEFAULT_EMAIL` | デフォルトの管理者メール（デスクトップモードでは使用しない） |
| `PGADMIN_DEFAULT_PASSWORD` | デフォルトの管理者パスワード（デスクトップモードでは使用しない） |
| `PGADMIN_CONFIG_SERVER_MODE` | `False` でデスクトップモード（ログイン画面スキップ） |

## トラブルシューティング

### pgAdmin にアクセスできない

```bash
# コンテナの状態を確認
docker ps --filter name=ax_saas_pgadmin

# ログを確認
docker logs ax_saas_pgadmin
```

postgres が起動完了していない場合、pgAdmin も起動しません。まず postgres の状態を確認してください。

### サーバーに接続できない

- Host が `postgres`（Docker ネットワーク内のサービス名）であることを確認
- `localhost` ではなく `postgres` を使用してください
- postgres コンテナが正常に動作しているか確認:

```bash
docker compose exec postgres pg_isready -U postgres
```

### データをリセットしたい

pgAdmin の設定（サーバー登録情報など）をリセットするには:

```bash
docker volume rm kikagaku-saas-template_pgadmin-data
```
