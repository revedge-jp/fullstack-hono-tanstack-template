# ADR-002: Cloudflare Hyperdrive の接続設定

**ステータス**: 採用済み
**日付**: 2026-03-14

---

## 背景

meetform は Supabase (PostgreSQL) を DB として使用し、Cloudflare Hyperdrive 経由で接続する。

---

## 問題と解決策

### 1. Session Mode (port 5432) vs Transaction Mode (port 6543)

Supabase は以下の2つの接続エンドポイントを提供する：

| モード | ポート | 特徴 |
|--------|--------|------|
| Session Mode | 5432 | Prepared statements 使用可能、接続が長期保持 |
| Transaction Mode | 6543 | PgBouncer 経由、Prepared statements 不可 |

**Hyperdrive は Transaction Mode との組み合わせで内部ノード間の調整エラーが発生する：**

```
PostgresError: Timed out while waiting for a message from another Hyperdrive node.
```

**採用**: Hyperdrive の接続先を **Session Mode (port 5432)** に設定する。
Cloudflare ダッシュボードの Hyperdrive 設定で Host を `aws-1-ap-northeast-1.pooler.supabase.com:5432` とする。

### 2. postgres.js の `max: 1`

CF Workers + Hyperdrive では、Worker のリクエストごとに新しい postgres.js クライアントを生成する（Hyperdrive が接続プールを管理するため）。

`max` を 1 より大きくすると、同一 Hyperdrive ノード上の複数接続間の調整失敗が起きる。

```typescript
// packages/database/src/index.ts
const client = postgres(connectionString, {
  prepare: false,  // Hyperdrive は Transaction Mode では Prepared statements 非対応
  max: 1,          // Hyperdrive が接続プールを管理するため 1 で十分
});
```

### 3. per-request クライアント + ctx.waitUntil(end())

CF Workers では、リクエストのレスポンスを返した後も Event Loop を生かし続けるために `ctx.waitUntil()` が必要。

```typescript
// apps/client/app/server.ts
const { app, end, auth } = initHonoApp(env);
const cleanup = () => end().catch(() => undefined);

const result = await handler(request);
ctx.waitUntil(cleanup());  // レスポンス送信後に接続をドレイン
return result;
```

`cleanup()` を呼ばずに Worker が終了すると、postgres.js の接続が正常にクローズされず、次のリクエストで不安定になる場合がある。

---

## 関連

- [Cloudflare Hyperdrive ドキュメント](https://developers.cloudflare.com/hyperdrive/)
- [postgres.js CF Workers ガイド](https://github.com/porsager/postgres#cloudflare-workers)
- [ADR-001: セッション検証方法](./adr-001-cf-workers-session-check.md)
