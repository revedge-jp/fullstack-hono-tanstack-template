import type { Auth } from "@app/integrations/auth";
import { err, ok, type Result } from "@repo/result";
import { type AuthUser, reconstituteAuthUser } from "../domain/models";

type Logger = { error: (obj: unknown, msg?: string) => void };

/**
 * リクエストからセッションを検証して AuthUser を返す。
 * Better Auth の session API を薄くラップする。
 */
export function makeVerifySession(auth: Auth, logger: Logger) {
  return async function verifySession(
    request: Request,
  ): Promise<Result<AuthUser, "Unauthorized" | "Unexpected">> {
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return err("Unauthorized");
      }
      return ok(
        reconstituteAuthUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        }),
      );
    } catch (e) {
      logger.error(e, "verifySession unexpected error");
      return err("Unexpected");
    }
  };
}
