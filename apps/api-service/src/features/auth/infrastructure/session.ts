import { readAuthApiError, type Auth } from "@app/integrations/external/auth";
import { readCauseCode, stringifyErrorSafe } from "@repo/logging";
import { err, ok, ResultAsync } from "neverthrow";

import { reconstituteAuthUser } from "../domain/models";

type Logger = { warn: (obj: unknown, msg?: string) => void };

/**
 * リクエストからセッションを検証して AuthUser と、レスポンスに付けるべき Set-Cookie を返す。
 * Better Auth の session API を薄くラップする。
 *
 * returnHeaders を付けないと、Better Auth は DB 上のセッションの有効期限を延ばしたうえで、その
 * Set-Cookie（session_token の新しい Max-Age、cookieCache の session_data）を捨てる。ブラウザは
 * /api/auth/get-session を叩かないので、ここで拾わないと cookie が更新される経路が無くなる。
 */
export function makeVerifySession(auth: Auth, logger: Logger) {
  return function verifySession(request: Request) {
    const verification = auth.api.getSession({ headers: request.headers, returnHeaders: true });
    return ResultAsync.fromPromise(verification, (e) => {
      const apiError = readAuthApiError(e);
      // セッション更新中に別リクエストがそのセッションを削除した(サインアウト等)ときは
      // APIError(UNAUTHORIZED) で reject される。障害ではなく未認証なので 401 にする。
      if (apiError?.statusCode === 401) {
        return "Unauthorized" as const;
      }
      // Error をそのまま渡すと、DrizzleQueryError の message / stack / own プロパティ `params` に
      // 埋め込まれたバインド値(セッショントークン等)がログに載る。redact はキー単位で文字列の中身に
      // 届かない。現状 DB 障害は Better Auth が APIError に包み直してから届くが、包まずに投げる経路が
      // 増えても漏らさないよう、app.ts の onError と同じく切り落とした message と識別子だけを出す。
      // warn にして error / err キーは使わない: "Unexpected" は呼び出し側の toHttp が 500 として error で
      // 1 件記録するので、ここでも error にすると 1 回の障害が Errors に 2 件数えられる（shared/db-error.ts と同じ）
      logger.warn(
        { detail: stringifyErrorSafe(e), causeCode: readCauseCode(e), ...apiError },
        "verifySession unexpected error",
      );
      return "Unexpected" as const;
    }).andThen(({ headers, response: session }) => {
      if (!session?.user) {
        return err("Unauthorized" as const);
      }
      return ok({
        user: reconstituteAuthUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        }),
        setCookieHeaders: headers.getSetCookie(),
      });
    });
  };
}
