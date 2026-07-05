/**
 * 他 feature からの通知を蓄積する活動ログのドメインモデル。
 */
export type ActivityId = string & { readonly _brand: "ActivityId" };

export type Activity = {
  readonly id: ActivityId;
  readonly ownerId: string;
  readonly kind: string;
  readonly message: string;
  readonly occurredAt: Date;
};

export function reconstituteActivity(raw: {
  id: string;
  ownerId: string;
  kind: string;
  message: string;
  occurredAt: Date;
}): Activity {
  return {
    id: raw.id as ActivityId,
    ownerId: raw.ownerId,
    kind: raw.kind,
    message: raw.message,
    occurredAt: raw.occurredAt,
  };
}
