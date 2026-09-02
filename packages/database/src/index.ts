import { type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export { sql };
export type { SQL };

// postgres.js は onnotice 未指定だと DB の NOTICE を素の console.log へ出す
// (connection.js の NoticeResponse)。それはアプリの pino を通らないため、redact も
// warn 以下の error/err を退避する安全網も効かない。呼び出し側のロガーへ委譲する。
type NoticeLogger = { warn: (obj: unknown, msg?: string) => void };

export function createDb(connectionString: string, logger?: NoticeLogger) {
  // CF Workers / Hyperdrive 前提の設定（経緯と実測は ADR-002 を参照）:
  //   max: 1            — 接続プールは Hyperdrive 側が管理する。2 以上にすると
  //                       "Timed out waiting for a message from another Hyperdrive node"
  //                       という Hyperdrive ノード間の調整エラーが実際に発生した
  //   prepare: false    — prepared statement に依存しない安全側の設定。Hyperdrive の接続先は
  //                       Session Mode（ADR-002）のため有効化できる可能性があるが、
  //                       変更する場合は staging での実測を経ること
  //   fetch_types: false — クライアントをリクエストごとに生成するため、既定の型 OID 取得が
  //                       毎リクエストに 1 往復を追加してしまう。配列型カラム不使用のため不要
  //   connect_timeout / idle_timeout — ハングした接続が唯一の接続（max: 1）を
  //                       無期限に占有しないための上限（秒）
  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
    fetch_types: false,
    connect_timeout: 5,
    idle_timeout: 20,
    onnotice: (notice) => {
      logger?.warn({ notice }, "postgres notice");
    },
  });
  const db = drizzle(client, { schema });
  return { db, end: () => client.end() };
}

export type Database = ReturnType<typeof createDb>["db"];

export type {
  DbActivity,
  DbAuthAccount,
  DbAuthSession,
  DbAuthUser,
  DbAuthVerification,
  DbTask,
} from "./schema";
export {
  activities,
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  TASK_STATUS_VALUES,
  tasks,
} from "./schema";
