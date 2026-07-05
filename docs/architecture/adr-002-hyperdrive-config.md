# ADR-002: Cloudflare Hyperdrive の接続設定

**ステータス**: 採用済み（2026-07 改訂: DB を Supabase から PlanetScale に変更）
**日付**: 2026-03-14（改訂 2026-07-05）

---

## 背景

このアプリは PlanetScale (PostgreSQL) を DB として使用し、Cloudflare Hyperdrive 経由で接続する。
DB・接続ロール・Hyperdrive は `alchemy.run.ts` が IaC として作成するため、
接続文字列を手動でコピーする工程はない（[Alchemy IaC ガイド](../dev/alchemy-iac.md)）。

> **改訂の経緯**: 当初は Supabase を使用していたが、Supabase 固有機能（Auth/Realtime/
> Storage/PostgREST）を一切使っておらず、staging/prod 常時 2DB 構成のコストと IaC 統合の
> 観点で PlanetScale が優位だったため移行した。本 ADR の教訓の多くは Supabase 時代の
> 障害調査で得られたもので、原則としてそのまま有効。

---

## 問題と解決策

### 1. Hyperdrive の origin は直接続エンドポイント（port 5432）を使う

PlanetScale は 2 つの接続エンドポイントを提供する：

| 接続 | ポート | 特徴 |
|--------|--------|------|
| 直接続 | 5432 | Postgres へ直接接続 |
| pooled (PgBouncer) | 6432 | PlanetScale 側の接続プーラー経由 |

**採用**: Hyperdrive の origin は**直接続（port 5432）**とする。`alchemy.run.ts` が
Role の接続情報（port 5432）を Hyperdrive に直結するため、構造的にこれが保証される。

**理由**: Hyperdrive 自体が接続プーラーであり、pooler（PgBouncer 等）の背後に置くと
プーラー二段構成になる。Supabase 時代に Transaction Mode pooler（port 6543）との
組み合わせで以下の内部調整エラーが発生した実績があり、同種の構成は避ける：

```
PostgresError: Timed out while waiting for a message from another Hyperdrive node.
```

### 2. postgres.js の `max: 1`

CF Workers + Hyperdrive では、Worker のリクエストごとに新しい postgres.js クライアントを生成する（Hyperdrive が接続プールを管理するため）。

`max` を 1 より大きくすると、同一 Hyperdrive ノード上の複数接続間の調整失敗が起きる。

```typescript
// packages/database/src/index.ts
const client = postgres(connectionString, {
  prepare: false,  // Hyperdrive の pooling モードでは Prepared statements 非対応
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
- [Cloudflare Blog: Deploy PlanetScale Postgres with Workers](https://blog.cloudflare.com/deploy-planetscale-postgres-with-workers/)
- [ADR-001: セッション検証方法](./adr-001-cf-workers-session-check.md)
- [Alchemy IaC ガイド](../dev/alchemy-iac.md)
