-- 既存の activities 行には owner が記録されておらず、誰のものか復元できない
-- （無認証時代の全ユーザー横断データ）。NOT NULL 追加の前に破棄する。
DELETE FROM "activities";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_auth_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
