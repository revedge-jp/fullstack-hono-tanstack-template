-- Better Auth 1.7.3 で issuer 列の要求が撤回され、Better Auth は issuer を書かなくなった（issue #172）。
-- NOT NULL のままだと新規登録・OAuth サインインの INSERT が 23502 で失敗するので、制約だけを外す。
-- 列と auth_accounts_issuer_account_idx の削除は、このリリースの後の contract のマイグレーションで行う。
ALTER TABLE "auth_accounts" ALTER COLUMN "issuer" DROP NOT NULL;