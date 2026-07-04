import { err, ok, type Result } from "neverthrow";

export type RecordActivityInput = { kind: string; message: string };

export function validateRecordActivity(
  input: RecordActivityInput,
): Result<RecordActivityInput, "Invalid"> {
  if (!input.kind.trim() || !input.message.trim()) {
    return err("Invalid" as const);
  }
  return ok(input);
}
