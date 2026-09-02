-- Better Auth 1.7: account の同一性が (issuer, account_id) になったため issuer 列を追加する。
-- 既存行は NOT NULL 制約を後付けできないので、Better Auth の既定値
-- (OAuth プロバイダ: `local:oauth:<provider_id>`)で backfill してから NOT NULL にする。
ALTER TABLE "auth_accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "auth_accounts" SET "issuer" = 'local:oauth:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_accounts_issuer_account_idx" ON "auth_accounts" USING btree ("issuer","account_id");
