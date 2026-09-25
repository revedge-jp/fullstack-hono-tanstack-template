import { readAuthApiError, type Auth } from "@app/integrations/external/auth";
import { readCauseCode, stringifyErrorSafe } from "@repo/logging";
import { err, ok, ResultAsync } from "neverthrow";

import { reconstituteAuthUser } from "../domain/models";

type Logger = { error: (obj: unknown, msg?: string) => void };

/**
 * リクエストからセッションを検証して AuthUser を返す。
 * Better Auth の session API を薄くラップする。
 */
export function makeVerifySession(auth: Auth, logger: Logger) {
  return function verifySession(request: Request) {
    return ResultAsync.fromPromise(auth.api.getSession({ headers: request.headers }), (e) => {
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
      logger.error(
        { err: stringifyErrorSafe(e), causeCode: readCauseCode(e), ...apiError },
        "verifySession unexpected error",
      );
      return "Unexpected" as const;
    }).andThen((session) => {
      if (!session?.user) {
        return err("Unauthorized" as const);
      }
      return ok(
        reconstituteAuthUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        }),
      );
    });
  };
}
