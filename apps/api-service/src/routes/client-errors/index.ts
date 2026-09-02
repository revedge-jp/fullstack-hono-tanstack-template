import { createApp } from "@app/factory";
import { zValidator } from "@app/shared/http/z-validator";
import { z } from "zod";

// クライアント(ブラウザ)で発生した JS エラーの通報受け口。
// サーバー(SSR)側エラーは app/server.ts が observability に出しているが、ハイドレーション後に
// ブラウザ内で完結するエラー(UIクラッシュ・unhandledrejection 等)は従来どこにも届かない。
//
// 設計方針:
// - 認証を要さない(サインイン画面など未認証状態でもエラーは起きる)。dev-auth と
//   同じく createApp() を直接使う(createAuthedApp/requireAuth は付けない)。
// - 個人情報を第三者へ出さないため、DB には保存せず observability ログにのみ流す。
//   ペイロードのフィールドは限定し、長さも上限を課す(PII の一次スクラブは呼び出し元 client で
//   行い、ここは受け入れ上限の防御に徹する)。
// - 濫用(公開エンドポイントへのログ洪水)防止のレート制限は app.ts のマウント側で付与する。

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 4000;
const MAX_PATH_LENGTH = 500;
const MAX_SHORT_FIELD_LENGTH = 200;

const ClientErrorReportSchema = z.object({
  // 発生源の種別。react-error-boundary は UI を実際に壊したクラッシュ、それ以外は
  // グローバルハンドラ(ブラウザ拡張由来のノイズを含みうる)なのでログレベルを分ける。
  kind: z.enum(["error", "unhandledrejection", "react-error-boundary"]),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  stack: z.string().max(MAX_STACK_LENGTH).optional(),
  // クエリ文字列・UUID を除去済みのパス(呼び出し元でスクラブ)。
  path: z.string().max(MAX_PATH_LENGTH).optional(),
  // このタブが最初に観測したアプリのバージョン(git SHA、x-app-version 由来)。
  appVersion: z.string().max(MAX_SHORT_FIELD_LENGTH).optional(),
});

export function createClientErrorsRouter() {
  return createApp().post("/", zValidator("json", ClientErrorReportSchema), (c) => {
    const report = c.req.valid("json");
    const logger = c.get("logger");
    const payload = {
      event: "client_error" as const,
      kind: report.kind,
      clientMessage: report.message,
      clientStack: report.stack,
      clientPath: report.path,
      clientAppVersion: report.appVersion,
      // UA はリクエストヘッダから取る(PII ではなく障害の再現環境特定に有用)。
      clientUserAgent: c.req.header("user-agent"),
    };
    // React error boundary の捕捉は実際に画面を壊したクラッシュなので error、
    // グローバルハンドラ由来はノイズを含みうるので warn にする。
    if (report.kind === "react-error-boundary") {
      // `error` キーを添えて Cloudflare の `$metadata.error` に載せる。ダッシュボードの
      // `exists($metadata.error)` は「要対応」フィルタとして使うため、実際に画面を壊した
      // クラッシュはここに現れる必要がある(clientMessage だけでは索引されない)。
      // error レベルなので @repo/logging の退避(warn 以下が対象)にも掛からない。
      logger?.error({ ...payload, error: report.message }, "client error reported");
    } else {
      logger?.warn(payload, "client error reported");
    }
    return c.body(null, 204);
  });
}
