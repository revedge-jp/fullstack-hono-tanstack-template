import type { RequestLogger } from "../middlewares/request-logger";

// requestLogger ミドルウェア(app.ts の buildApp で全ルートに登録)が context に載せる
// ロガーを、factory の Env 型を経由しない Context(zValidator のフック等)からも
// `c.get("logger")` で型安全に参照できるようにする Hono の公式拡張ポイント。
// interface は arch:guards で禁止だが、モジュール拡張は interface でしか書けないため
// .d.ts(ガード除外)に置く。
declare module "hono" {
  interface ContextVariableMap {
    logger: RequestLogger | undefined;
  }
}
