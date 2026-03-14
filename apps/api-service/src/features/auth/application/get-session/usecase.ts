import { flow, type Result } from "@repo/result";
import type { AuthUser } from "../../domain/models";

type GetSessionError = "Unauthorized" | "Unexpected";

type VerifySession = (req: Request) => Promise<Result<AuthUser, GetSessionError>>;

type Deps = {
  verifySession: VerifySession;
};

export function makeGetSession(deps: Deps) {
  return async function getSession(request: Request): Promise<Result<AuthUser, GetSessionError>> {
    return flow<Request>(request)
      .asyncAndThen((req) => deps.verifySession(req))
      .value();
  };
}
