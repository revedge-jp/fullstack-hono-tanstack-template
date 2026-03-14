# データモデル

## Better Auth 管理（定義不要）

**user**
| カラム | 型 |
|---|---|
| id | text PK |
| email | text UNIQUE |
| name | text |
| emailVerified | boolean |
| createdAt | timestamp |
| updatedAt | timestamp |

**organization**
| カラム | 型 |
|---|---|
| id | text PK |
| name | text |
| slug | text UNIQUE |
| createdAt | timestamp |

**member**
| カラム | 型 |
|---|---|
| id | text PK |
| organizationId | text FK → organization.id |
| userId | text FK → user.id |
| role | text (owner / admin / member) |
| createdAt | timestamp |

**invitation**
| カラム | 型 |
|---|---|
| id | text PK |
| organizationId | text FK → organization.id |
| email | text |
| role | text |
| status | text |
| expiresAt | timestamp |

---

## 自前定義

**event**
| カラム | 型 | 備考 |
|---|---|---|
| id | text PK | |
| organizationId | text FK → organization.id | |
| title | text | |
| description | text | nullable |
| location | text | nullable |
| startsAt | timestamp | |
| endsAt | timestamp | nullable |
| capacity | integer | |
| status | text | draft / published / closed |
| embedAllowedOrigins | text[] | 空 = どこでも埋め込み可 |
| redirectUrl | text | nullable、未設定 = デフォルトサンクス画面 |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**registration**
| カラム | 型 | 備考 |
|---|---|---|
| id | text PK | |
| eventId | text FK → event.id | |
| name | text | |
| email | text | |
| status | text | confirmed / cancelled |
| cancelToken | uuid UNIQUE | キャンセルリンク用 |
| createdAt | timestamp | |
| cancelledAt | timestamp | nullable |

---

## 制約

- `(eventId, email)` UNIQUE → 同一メールの重複申込を DB レベルで防ぐ
