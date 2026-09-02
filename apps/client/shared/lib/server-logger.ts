import { createLogger } from "@repo/logging";

// SSR 経路(createServerFn のハンドラ・Worker エントリ)用の共有ロガー。
//
// 【ブラウザから import しないこと】このモジュールは pino を引き込む。createServerFn の
// ハンドラはビルド時にクライアントバンドルから除かれるため SSR 経路からの参照は安全だが、
// UI コンポーネントから直接 import するとバンドルに載る。
//
// 生の console を使わないのは、client と api-service が同一の Worker にビルドされ同じ
// Observability データセットに入るため。`error` / `err` キーは 5xx・未捕捉例外専用で、
// warn 以下でこのキーを使うと Cloudflare の既定フィルタで本物の異常が埋もれる。
export const serverLogger = createLogger({ service: "client-server", environment: "production" });
