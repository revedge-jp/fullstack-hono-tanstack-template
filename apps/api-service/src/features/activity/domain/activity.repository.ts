import type { ResultAsync } from "neverthrow";

import type { Activity } from "./models";

export type ActivityRepository = {
  record(input: {
    ownerId: string;
    kind: string;
    message: string;
  }): ResultAsync<Activity, "Unexpected">;
  list(input: { ownerId: string }): ResultAsync<{ items: Activity[] }, "Unexpected">;
};
