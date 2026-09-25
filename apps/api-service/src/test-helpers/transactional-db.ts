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
// すべて同じ値になる。時刻順に依存するテスト（keyset ページネーション等）は時刻の列を明示して
// シードすること。任せると全行が同時刻になり、時刻での絞り込みが一度も通らないまま緑になる。
//
// 【テスト本体と beforeEach では rawDb / $client を使わない】createDb は接続が1本（max: 1、
// ADR-002）で、テスト中はそれをこの fixture のトランザクションが握っている。ルートの接続を通る
// クエリは afterEach で接続が空くまで待たされ、テストのタイムアウトで落ちる（原因の読めない
// タイムアウトになる）。
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
          // 偽るのではなく、`$client` を書き足して `Database` を満たす（`Object.assign` は `T & U` と
          // して型付けされるのでキャスト不要）。**この `$client` は型を満たすためだけのもので、
          // トランザクションの接続ではなくルートの接続を指す**。テスト内で使うとトランザクションの外で
          // 動き（ロールバックされない）、しかも上の理由で接続待ちのまま固まる。
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
    // ファイル直下の beforeAll/afterAll で、ファイル全体が共有する読み取り専用フィクスチャを
    // 作る/消すための、トランザクションに包まれない生ハンドル。rawDb でコミットした行は、
    // READ COMMITTED の下で以降開始する全ての per-test トランザクションから見える。
    // テスト本体・beforeEach（describe 内の入れ子を含む）では使わない（接続待ちで固まる。上述）。
    rawDb: db,
    // 接続のクローズはここでは自動登録しない — bun:test の afterAll は登録順に実行されるため、
    // ここで先に afterAll(end) を登録すると、呼び出し側が rawDb で行う後始末より先に接続が
    // 閉じてしまう（移植元で実測: CONNECTION_ENDED）。呼び出し側の afterAll の最後で end() を呼ぶ。
    end,
  };
}
