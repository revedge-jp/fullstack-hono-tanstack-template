import { err, ok, type Result } from "neverthrow";

export type RecordActivityInput = { ownerId: string; kind: string; message: string };

export function validateRecordActivity(
  input: RecordActivityInput,
): Result<RecordActivityInput, "Invalid"> {
  if (!input.ownerId.trim() || !input.kind.trim() || !input.message.trim()) {
    return err("Invalid" as const);
  }
  return ok(input);
}
