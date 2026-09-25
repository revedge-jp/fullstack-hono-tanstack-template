import { afterEach, beforeEach } from "bun:test";

import { createDb, type Database } from "@repo/db";

// integration テストを BEGIN → ROLLBACK で包む共有 fixture。
// 移植元: revedge-jp/chiryonavi#1152（同リポジトリ issue #1109 で実測）。
//
// 【なぜ手動 delete が要らなくなるか】各テストの直前に外側トランザクションを開いたまま
// 保留し（「開始した」ことを表す Promise だけ resolve して本体は宙に浮かせる）、テスト本体は
// `getDb()` が返すその tx を唯一の DB ハンドルとして使う。afterEach で保留中の Promise を
// reject すると `db.transaction()` のコールバックが例外で終わり、drizzle が ROLLBACK を
// 発行する — その時点でテスト中に行った insert/update/delete は全て取り消される。
//
// 【リポジトリ自身が db.transaction() を張っても安全】drizzle-orm の postgres-js アダプタは、
// 既に `PostgresJsTransaction` になっている値（= ここで注入する tx）に対する `.transaction(cb)`
// 呼び出しを自動的に SAVEPOINT へマップする。そのため `createTasksRepository({ db: getDb() })`
// のように tx をリポジトリへそのまま渡してよく、リポジトリ内部の `db.transaction()` は
// savepoint として安全にネストする。
//
// 【意図的に DB エラーを起こすアサーションは savepoint で包むこと】PostgreSQL はトランザクション内で
// エラーが起きるとそのトランザクション全体を「中断」状態にし、ROLLBACK か savepoint 境界に
// 達するまで以降の全クエリを失敗させる（25P02 current transaction is aborted）。制約違反を
// 確かめた後に同じテストでクエリを続けるなら、エラーを起こす処理を `getDb().transaction(fn)` で
// 包んで savepoint 単位に閉じ込める。
//
// 【now() はトランザクション開始時刻で固定される】1テスト内で作った行の `defaultNow()` 列は
// すべて同じ値になる。時刻順に依存するテストは、同着のタイブレーク（id 等）まで含めて検証される。
export function createTransactionalDb(databaseUrl: string): {
  // beforeEach 完了後〜afterEach 開始前（= テスト本体）以外で呼ぶと undefined。呼び出し側
  // （常に *.test.ts）で `getDb()!` として受け取る — 非 null アサーションは *.test.ts でのみ
  // 許可されているため（ADR-003）、この判断を呼び出し側のテストファイルに置く。
  getDb: () => Database | undefined;
  rawDb: Database;
  end: () => Promise<void>;
} {
  const { db, end } = createDb(databaseUrl);
  let tx: Database | undefined;
  let release: ((err: unknown) => void) | undefined;
  let settled: Promise<void> = Promise.resolve();

  beforeEach(async () => {
    let reachedCallback = false;
    const started = new Promise<void>((resolveStarted, rejectStarted) => {
      settled = db
        .transaction(async (t) => {
          reachedCallback = true;
          // drizzle の型上、トランザクションハンドル（PgTransaction）はルートの Database 型が持つ
          // `$client`（生の postgres.js 接続）を欠く（クエリビルダーとしての実体は互換）。`as` で型だけ
          // 偽るのではなく、実際に `$client` を書き足す（`Object.assign` は `T & U` として型付け
          // されるので、キャスト無しで `Database` を満たす。配下の接続は元の `db` と同じ postgres.js
          // クライアントなので値としても正しい）。
          tx = Object.assign(t, { $client: db.$client });
          resolveStarted();
          await new Promise((_resolve, reject) => {
            release = reject;
          });
        })
        .catch((e) => {
          // release() による reject はこの fixture 自身のロールバック信号なので無視する。
          // コールバックへ一度も到達しないまま拒否された場合（接続エラー等）だけ started 側にも
          // 伝播させる — でないと beforeEach が無期限にハングする。
          if (!reachedCallback) {
            rejectStarted(e);
          }
        });
    });
    await started;
  });

  afterEach(async () => {
    release?.(new Error("transactional test fixture: rollback"));
    // ROLLBACK が実際に完了するまで待つ（次のテストの beforeEach が新しいトランザクションを
    // 開く前に、このトランザクションが確実に終わっている必要がある）。
    await settled;
    tx = undefined;
    release = undefined;
  });

  return {
    getDb: () => tx,
    // beforeAll/afterAll でファイル全体が共有する読み取り専用フィクスチャを作る/消すための、
    // トランザクションに包まれない生ハンドル。rawDb でコミットした行は、READ COMMITTED の下で
    // 以降開始する全ての per-test トランザクションから見える。
    rawDb: db,
    // 接続のクローズはここでは自動登録しない — bun:test の afterAll は登録順に実行されるため、
    // ここで先に afterAll(end) を登録すると、呼び出し側が rawDb で行う後始末より先に接続が
    // 閉じてしまう（移植元で実測: CONNECTION_ENDED）。呼び出し側の afterAll の最後で end() を呼ぶ。
    end,
  };
}
