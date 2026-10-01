import { afterAll, describe, expect, test } from "bun:test";

import { createAuth, type AuthLogger } from "@app/integrations/external/auth";
import { createTransactionalDb } from "@app/test-helpers/transactional-db";
import type { Database } from "@repo/db";

// Better Auth の更新で auth_accounts に求める列が変わっても、unit / contract（セッションを偽装する）は
// auth_accounts へ書き込まないので検出できない。OAuth コールバックが通る「ユーザーとアカウントの作成 →
// (providerId, accountId) での引き直し」を、実際の Better Auth 設定と migrate 済みの実 DB で確かめる。
// 1.7.0〜1.7.2 は NOT NULL の issuer 列を要求し、1.7.3 以降は issuer を書かない（issue #172）。
// どちらに食い違っても新規登録と Google サインインがすべて失敗する。
const { getDb: getTx, end } = createTransactionalDb(process.env.DATABASE_URL ?? "");

function getDb(): Database {
  return getTx()!;
}

const noopLogger: AuthLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

afterAll(async () => {
  await end();
});

describe("Better Auth の account 書き込み（実DB + 実際の Better Auth 設定）", () => {
  test("OAuth ユーザーの作成で auth_accounts に行が入り、(providerId, accountId) で引ける", async () => {
    const auth = createAuth(
      {
        secret: "integration-test-secret-0123456789abcdef",
        trustedOrigins: [],
        googleClientId: "integration-test-client-id",
        googleClientSecret: "integration-test-client-secret",
      },
      "test",
      getDb(),
      noopLogger,
    );
    const context = await auth.$context;
    const googleSubject = `google-sub-${crypto.randomUUID()}`;

    const { user, account } = await context.internalAdapter.createOAuthUser(
      {
        name: "account schema 統合テストユーザー",
        email: `account-schema-${crypto.randomUUID()}@example.com`,
        emailVerified: true,
      },
      { providerId: "google", accountId: googleSubject },
    );

    expect(account.userId).toBe(user.id);
    const found = await context.internalAdapter.findAccountByKey({
      providerId: "google",
      accountId: googleSubject,
    });
    expect(found?.id).toBe(account.id);
    expect(found?.userId).toBe(user.id);
  });
});
