import { createMiddleware } from "hono/factory";

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  // クライアント識別子の抽出。既定は CF-Connecting-IP（本番）→ x-forwarded-for → "unknown"。
  keyGenerator?: (req: Request) => string;
};

type Bucket = { count: number; resetAt: number };

function defaultKey(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * レート制限のカウントの置き場。`rateLimit()` から切り離しているのは、ミドルウェアを作る頻度と
 * カウントを保つ期間が一致しないため。Workers ではアプリ（ミドルウェアごと）をリクエストのたびに
 * 組み立て直すので、ミドルウェアの中で作るとカウントが毎回 0 から始まり、制限が一度も効かない。
 * 呼び出し側がモジュールスコープ（= isolate 単位）で1つ作って渡す（app.ts の isolateRateLimitStores）。
 */
export type RateLimitStore = {
  // key ごとの現在ウィンドウのカウント。
  buckets: Map<string, Bucket>;
  lastSweep: number;
};

export function createRateLimitStore(): RateLimitStore {
  return { buckets: new Map(), lastSweep: Date.now() };
}

/**
 * 依存ゼロの固定ウィンドウ・レート制限ミドルウェア。
 *
 * 制限の状態は `store`（呼び出し側が isolate 単位で持つメモリ）にのみ保持する。1 isolate の中では
 * 機能するが、複数 isolate にスケールすると各々が独立にカウントするため、実効レートは
 * isolate 数倍に緩む。厳密な分散レート制限が必要なら Workers KV / Durable Objects などの
 * 共有ストアに差し替えること。
 *
 * process.env は読まない（config → DI 経由で渡す）。
 */
export function rateLimit(options: RateLimitOptions & { store: RateLimitStore }) {
  const { windowMs, max, keyGenerator = defaultKey, store } = options;
  const { buckets } = store;
  // 二度と再訪されない key（例: 使い捨て IP の大量アクセス）のエントリが溜まり続けて
  // メモリが無限に増えるのを防ぐため、期限切れエントリを間引く。毎リクエスト O(n) を走らせると
  // ホットパスが重くなるので、最大でも windowMs に 1 回だけ全体スイープする（償却で軽量）。
  const sweepExpired = (now: number) => {
    if (now - store.lastSweep < windowMs) {
      return;
    }
    store.lastSweep = now;
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) {
        buckets.delete(k);
      }
    }
  };

  return createMiddleware(async (c, next) => {
    const now = Date.now();
    sweepExpired(now);
    const key = keyGenerator(c.req.raw);
    const existing = buckets.get(key);

    let bucket: Bucket;
    if (!existing || existing.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    } else {
      bucket = existing;
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSec = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ ok: false, error: "Too Many Requests" }, 429);
    }

    await next();
  });
}
