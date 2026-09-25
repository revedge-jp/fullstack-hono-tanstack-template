import { okAsync, type ResultAsync } from "neverthrow";

import type { AuthUser } from "../../domain/models";

type GetSessionError = "Unauthorized" | "Unexpected";

// setCookieHeaders は Better Auth がセッション検証のついでに返す Set-Cookie（有効期限の延長・
// cookieCache の書き直し）。呼び出し側がレスポンスに付けないと、DB 上のセッションだけが延びて
// ブラウザの cookie はサインイン時の期限で切れる（使い続けていても 7 日でサインアウトされる）。
type VerifiedSession = { user: AuthUser; setCookieHeaders: string[] };

type VerifySession = (req: Request) => ResultAsync<VerifiedSession, GetSessionError>;

type Deps = {
  verifySession: VerifySession;
};

export function makeGetSession(deps: Deps) {
  return function getSession(request: Request): ResultAsync<VerifiedSession, GetSessionError> {
    return okAsync(request).andThen((req) => deps.verifySession(req));
  };
}
