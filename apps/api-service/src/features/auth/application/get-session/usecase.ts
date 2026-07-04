import { okAsync, type ResultAsync } from "neverthrow";
import type { AuthUser } from "../../domain/models";

type GetSessionError = "Unauthorized" | "Unexpected";

type VerifySession = (req: Request) => ResultAsync<AuthUser, GetSessionError>;

type Deps = {
  verifySession: VerifySession;
};

export function makeGetSession(deps: Deps) {
  return function getSession(request: Request): ResultAsync<AuthUser, GetSessionError> {
    return okAsync(request).andThen((req) => deps.verifySession(req));
  };
}
