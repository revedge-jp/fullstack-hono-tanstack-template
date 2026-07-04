/**
 * 他 feature からの通知を蓄積する活動ログのドメインモデル。
 */
export type ActivityId = string & { readonly _brand: "ActivityId" };

export type Activity = {
  readonly id: ActivityId;
  readonly kind: string;
  readonly message: string;
  readonly occurredAt: Date;
};

export function reconstituteActivity(raw: {
  id: string;
  kind: string;
  message: string;
  occurredAt: Date;
}): Activity {
  return {
    id: raw.id as ActivityId,
    kind: raw.kind,
    message: raw.message,
    occurredAt: raw.occurredAt,
  };
}
