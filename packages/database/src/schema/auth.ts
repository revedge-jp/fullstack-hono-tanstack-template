import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// tasks / activities と同じく withTimezone + precision 3（ミリ秒）に揃える。
// JS の Date はミリ秒精度のため、DB 側をマイクロ秒のままにすると往復で精度がずれる
// （tasks.ts の rationale を参照）。auth テーブルも同じ方針で統一する。
const TS_OPTS = { withTimezone: true, precision: 3 } as const;

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", TS_OPTS).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", TS_OPTS).notNull().defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", TS_OPTS).notNull(),
    // token は unique（= 一意インデックス）。Better Auth はセッションを token で参照するため、
    // この一意制約がそのままルックアップ用インデックスとして機能する。
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", TS_OPTS).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", TS_OPTS).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    // user のセッション一覧・cascade 削除のホットパス（WHERE user_id = ?）用。
    index("auth_sessions_user_id_idx").on(table.userId),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", TS_OPTS),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", TS_OPTS),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", TS_OPTS).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", TS_OPTS).notNull().defaultNow(),
  },
  (table) => [
    // user の紐付けアカウント検索・cascade 削除（WHERE user_id = ?）用。
    index("auth_accounts_user_id_idx").on(table.userId),
    // OAuth コールバックの「この provider のこの accountId」ルックアップ用の複合インデックス。
    // 一意制約（unique）ではなくインデックスにするのは意図的: 一意性は Better Auth 側が管理しており、
    // 既存データに重複ペアがあった場合に unique 制約追加のマイグレーションが失敗するリスクを避けるため
    // （新規テンプレートでは無害だが、既存 DB へ後付けする利用者を想定した安全側の選択）。
    index("auth_accounts_provider_account_idx").on(table.providerId, table.accountId),
  ],
);

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", TS_OPTS).notNull(),
  createdAt: timestamp("created_at", TS_OPTS).defaultNow(),
  updatedAt: timestamp("updated_at", TS_OPTS).defaultNow(),
});

export type DbAuthUser = typeof authUsers.$inferSelect;
export type DbAuthSession = typeof authSessions.$inferSelect;
export type DbAuthAccount = typeof authAccounts.$inferSelect;
export type DbAuthVerification = typeof authVerifications.$inferSelect;
