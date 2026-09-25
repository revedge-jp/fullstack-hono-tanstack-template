import { afterEach, beforeEach } from "bun:test";

import { createDb, type Database } from "@repo/db";

// integration テストを BEGIN → ROLLBACK で包む共有 fixture。各テストの直前に外側トランザクションを
// 開いたまま保留し（「開始した」ことを表す Promise だけ resolve して本体は宙に浮かせる）、テスト本体には
// その tx を `getDb()` で渡す。afterEach で保留中の Promise を reject するとコールバックが例外で終わり、
// drizzle が ROLLBACK を発行する。
//
// 使い方と落とし穴（リポジトリ内の transaction() は SAVEPOINT になる・DB エラーを起こすアサーションは
// savepoint で包む・now() が固定される・テスト本体で rawDb を使うとタイムアウトする）は
// .claude/rules/api-service.md の「integration テストは手書きの後始末を書かない」。
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
