import type { ResultAsync } from "neverthrow";

import type { Activity } from "./models";

export type ActivityRepository = {
  record(input: { kind: string; message: string }): ResultAsync<Activity, "Unexpected">;
  list(): ResultAsync<{ items: Activity[] }, "Unexpected">;
};
