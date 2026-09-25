import type { Auth } from "@app/integrations/external/auth";
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
      // Error をそのまま渡すと、DB 障害時の DrizzleQueryError の message / stack / own プロパティ
      // `params` に埋め込まれたバインド値(セッショントークン等)がログに載る。redact はキー単位で
      // 文字列の中身に届かないので、app.ts の onError と同じく切り落とした message と cause の code だけを出す。
      logger.error(
        { err: stringifyErrorSafe(e), causeCode: readCauseCode(e) },
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
