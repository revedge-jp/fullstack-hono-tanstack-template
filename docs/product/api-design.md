# API 設計

## 凡例

- 🔒 要認証（Better Auth セッション）
- 🌐 公開（認証不要）

---

## 認証（Better Auth 自動生成）

```
POST /api/auth/sign-up
POST /api/auth/sign-in
POST /api/auth/sign-out
GET  /api/auth/session
     /api/auth/organization/*   チーム・メンバー・招待管理
```

---

## イベント

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | /api/events | 🔒 | 自組織のイベント一覧 |
| POST | /api/events | 🔒 | イベント作成 |
| GET | /api/events/:id | 🔒 | イベント詳細（管理用） |
| PATCH | /api/events/:id | 🔒 | イベント更新 |
| DELETE | /api/events/:id | 🔒 | イベント削除 |
| GET | /api/events/:id/public | 🌐 | イベント公開情報（iframe widget 用） |

### GET /api/events/:id/public レスポンス

```json
{
  "id": "xxx",
  "title": "2024年 春の会社説明会",
  "description": "...",
  "location": "東京オフィス",
  "startsAt": "2024-04-01T10:00:00Z",
  "capacity": 10,
  "remainingCapacity": 3,
  "status": "published"
}
```

---

## 申込

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| POST | /api/events/:id/registrations | 🌐 | 申込（iframe widget から） |
| GET | /api/events/:id/registrations | 🔒 | 申込者一覧 |
| GET | /api/events/:id/registrations/export | 🔒 | 申込者一覧 CSV ダウンロード |

### POST /api/events/:id/registrations リクエスト

```json
{
  "name": "山田 太郎",
  "email": "yamada@example.com"
}
```

### POST /api/events/:id/registrations レスポンス

```json
{
  "id": "xxx",
  "name": "山田 太郎",
  "email": "yamada@example.com",
  "status": "confirmed"
}
```

**エラーケース**

| ステータス | 内容 |
|---|---|
| 409 | 同一メールアドレスが申込済み |
| 422 | 定員に達している |

---

## キャンセル

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| DELETE | /api/registrations/:id | 🔒 | 主催者によるキャンセル |
| POST | /api/registrations/cancel | 🌐 | 申込者によるキャンセル（トークン認証） |

### POST /api/registrations/cancel リクエスト

```json
{
  "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

---

## キャンセル確認ページ（APIではなくページルート）

```
GET /cancel?token=xxx
```

メール内リンクの遷移先。「キャンセルしますか？」確認画面を表示し、
ユーザーが確認ボタンを押した時に `POST /api/registrations/cancel` を呼び出す。

> メールセキュリティスキャナーによる誤キャンセルを防ぐため、
> キャンセルの副作用は必ず POST で実行する。
