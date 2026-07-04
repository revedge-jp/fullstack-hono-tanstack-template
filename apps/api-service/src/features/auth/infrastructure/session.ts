import type { Auth } from "@app/integrations/external/auth";
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
      logger.error(e, "verifySession unexpected error");
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
