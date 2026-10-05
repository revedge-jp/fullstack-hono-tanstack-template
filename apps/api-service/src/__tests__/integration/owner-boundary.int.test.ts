import { afterAll, describe, expect, test } from "bun:test";

import { createActivityService } from "@app/features/activity/application/service";
import { createActivityRepository } from "@app/features/activity/infrastructure/activity.repository.drizzle";
import { reconstituteAuthUser } from "@app/features/auth/domain/models";
import { createTasksService } from "@app/features/tasks/application/service";
import { createTasksRepository } from "@app/features/tasks/infrastructure/tasks.repository.drizzle";
import { createActivityRecorder } from "@app/integrations/composition/activity-recorder";
import { createFakeApp } from "@app/test-helpers/create-fake-app";
import { createLoggerSpy } from "@app/test-helpers/create-logger-spy";
import { createTransactionalDb } from "@app/test-helpers/transactional-db";
import { activities, authUsers, type Database, tasks } from "@repo/db";
import { sql } from "drizzle-orm";

// 所有者の境界の横断テスト。更新系ルートを実ハンドラ・実 DB で叩き、**対象以外の行が1行も変わらない**
// ことを全テーブルの前後比較で確かめる。
//
// 個別のテストは「対象の行が正しく変わるか」「他人の ID を渡すと NotFound か」を見るが、どちらも
// 「対象以外の行が巻き込まれないこと」は見ていない。所有者がタスクを1件しか持たないフィクスチャでは、
// WHERE から id の条件が落ちても（所有者の全行を書き換える）、括弧の無い OR で他人の行に当たっても、
// 正しい実装と結果が一致して緑になる（派生プロダクトで、全テナントの行を書き換える UPDATE がこの形で
// レビュー・統合テスト・監査をすり抜けた）。WHERE の条件落ち・スコープの付け忘れ・演算子の結合順の誤りは、
// どれも「他の行が変わる」形で表に出るので、ここで1つの網として捕まえる。
// 手前の読み取りが所有者で絞っていて表に出ない付け忘れ（update の ownerId だけが落ちる等）は捕まえられない。
// それはリポジトリ単体の適合テスト（repository-conformance.int.test.ts）が受け持つ。
//
// **更新系ルート（POST / PUT / PATCH / DELETE）を足したら PROBES に足す**。足さないと網羅性のテストで落ちる。
// 叩かない理由があるルートは EXCLUDED_ROUTES に理由を添えて足す。

const { getDb: getTx, end } = createTransactionalDb(process.env.DATABASE_URL ?? "");

function getDb(): Database {
  return getTx()!;
}

afterAll(async () => {
  await end();
});

const BASE = Date.UTC(2026, 0, 1);

// 両方の所有者に同じ形の行を置く（タイトル・status・時刻をそろえる）。WHERE の条件が1つ落ちたとき、
// 当てはまる行が他の所有者・同じ所有者の別の行に必ずあるようにするため。
// 対象の行と同じ status の行（todo-peer）を置くのは、楽観ロックの条件（status = 読んだ値）だけが
// 残った UPDATE でも巻き込まれる行があるようにするため。
const TASK_SHAPES = [
  { key: "patch-target", status: "todo" },
  { key: "delete-target", status: "todo" },
  { key: "todo-peer", status: "todo" },
  { key: "in-progress-peer", status: "in_progress" },
  { key: "done-peer", status: "done" },
  // 作成のプローブと同じタイトル。もう一方の所有者が同じタイトルを持っていても作れることも兼ねる
  { key: "created-title", status: "todo" },
] as const;

type TaskKey = (typeof TASK_SHAPES)[number]["key"];

type OwnerSeed = { id: string; taskIds: Record<TaskKey, string> };

type Seed = { actor: OwnerSeed; other: OwnerSeed };

async function seedOwner(db: Database, label: string, omit: TaskKey[]): Promise<OwnerSeed> {
  const id = `owner-boundary-${label}-${crypto.randomUUID()}`;
  await db.insert(authUsers).values({ id, name: label, email: `${id}@example.com` });
  const rows = await db
    .insert(tasks)
    .values(
      TASK_SHAPES.filter(({ key }) => !omit.includes(key)).map(({ key, status }, index) => ({
        ownerId: id,
        title: key,
        status,
        createdAt: new Date(BASE + index * 1000),
        updatedAt: new Date(BASE + index * 1000),
      })),
    )
    .returning({ id: tasks.id, title: tasks.title });
  await db.insert(activities).values([
    { ownerId: id, kind: "task_created", message: "patch-target", occurredAt: new Date(BASE) },
    { ownerId: id, kind: "task_created", message: "todo-peer", occurredAt: new Date(BASE + 1000) },
  ]);
  const taskIds: Record<string, string> = {};
  for (const row of rows) {
    taskIds[row.title] = row.id;
  }
  return { id, taskIds: taskIds as Record<TaskKey, string> };
}

async function seed(db: Database): Promise<Seed> {
  // 操作する側は作成のプローブで作るので、同じタイトルの行を持たせない
  const actor = await seedOwner(db, "actor", ["created-title"]);
  const other = await seedOwner(db, "other", []);
  return { actor, other };
}

type Row = Record<string, unknown>;
type Snapshot = Map<string, Map<string, Row>>;

// public スキーマの全テーブルを読む。テーブルを足しても、ここを直さずに比較の対象に入る
async function snapshot(db: Database): Promise<Snapshot> {
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const result: Snapshot = new Map();
  for (const { table_name: table } of tables) {
    const rows = await db.execute<Row>(sql`SELECT * FROM ${sql.identifier(table)}`);
    const byId = new Map<string, Row>();
    for (const row of rows) {
      if (typeof row.id !== "string") {
        throw new Error(`${table} に文字列の id 列が無い。行の識別方法をこのテストに足す`);
      }
      byId.set(row.id, row);
    }
    result.set(table, byId);
  }
  return result;
}

type Allowed = {
  // 変わってよい（更新・削除されてよい）行の id
  changes: string[];
  // 操作する側の所有として新しい行が入ってよいテーブル
  inserts: string[];
};

function findViolations(before: Snapshot, after: Snapshot, actorId: string, allowed: Allowed) {
  const violations: string[] = [];
  for (const table of new Set([...before.keys(), ...after.keys()])) {
    const beforeRows = before.get(table) ?? new Map<string, Row>();
    const afterRows = after.get(table) ?? new Map<string, Row>();
    for (const id of new Set([...beforeRows.keys(), ...afterRows.keys()])) {
      const was = beforeRows.get(id);
      const now = afterRows.get(id);
      if (JSON.stringify(was) === JSON.stringify(now)) {
        continue;
      }
      if (allowed.changes.includes(id)) {
        continue;
      }
      if (was === undefined && allowed.inserts.includes(table) && now?.owner_id === actorId) {
        continue;
      }
      violations.push(`${table} ${id}: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
    }
  }
  return violations;
}

type Probe = {
  route: string;
  name: string;
  request: (seed: Seed) => { path: string; body?: unknown };
  status: number;
  allowed: (seed: Seed) => Allowed;
};

const NOTHING: Allowed = { changes: [], inserts: [] };

const PROBES: Probe[] = [
  {
    route: "POST /api/tasks",
    name: "自分のタスクを作る",
    request: () => ({ path: "/api/tasks", body: { title: "created-title" } }),
    status: 201,
    allowed: () => ({ changes: [], inserts: ["tasks", "activities"] }),
  },
  {
    route: "PATCH /api/tasks/:id",
    name: "自分のタスクを進める",
    request: ({ actor }) => ({ path: `/api/tasks/${actor.taskIds["patch-target"]}` }),
    status: 200,
    allowed: ({ actor }) => ({ changes: [actor.taskIds["patch-target"]], inserts: [] }),
  },
  {
    route: "PATCH /api/tasks/:id",
    name: "他人のタスクの ID を渡す",
    request: ({ other }) => ({ path: `/api/tasks/${other.taskIds["patch-target"]}` }),
    status: 404,
    allowed: () => NOTHING,
  },
  {
    route: "DELETE /api/tasks/:id",
    name: "自分のタスクを消す",
    request: ({ actor }) => ({ path: `/api/tasks/${actor.taskIds["delete-target"]}` }),
    status: 204,
    allowed: ({ actor }) => ({ changes: [actor.taskIds["delete-target"]], inserts: [] }),
  },
  {
    route: "DELETE /api/tasks/:id",
    name: "他人のタスクの ID を渡す",
    request: ({ other }) => ({ path: `/api/tasks/${other.taskIds["delete-target"]}` }),
    status: 404,
    allowed: () => NOTHING,
  },
];

// 叩かない更新系ルート。ルートのパスを正規表現で当てる（route-auth.contract.test.ts の PUBLIC_ROUTES と同じ方式）
const EXCLUDED_ROUTES: ReadonlyArray<{ path: RegExp; reason: string }> = [
  {
    path: /^\/api\/auth\//,
    reason: "Better Auth の行はライブラリがセッションで絞る。このリポジトリの WHERE を通らない",
  },
  { path: /^\/api\/client-errors$/, reason: "DB に書かない（ログを出すだけ）" },
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// app.use（ミドルウェア）は ALL で出てくるので対象にしない。`.all()` でハンドラを書くと、ここでは見えない
function mutatingRoutes() {
  const keys = new Set<string>();
  for (const route of createFakeApp().routes) {
    if (MUTATING_METHODS.has(route.method)) {
      keys.add(`${route.method} ${route.path}`);
    }
  }
  return [...keys];
}

function buildActorApp(db: Database, actorId: string) {
  const logger = createLoggerSpy().logger;
  const activity = createActivityService({
    activityRepository: createActivityRepository({ db, logger }),
  });
  const tasksService = createTasksService({
    tasksRepository: createTasksRepository({ db, logger }),
    activityRecorder: createActivityRecorder({ activity }),
    logger,
  });
  return createFakeApp({
    user: reconstituteAuthUser({ id: actorId, email: `${actorId}@example.com`, name: "actor" }),
    tasks: tasksService,
    activity,
  });
}

describe("更新系ルートは、操作の対象以外の行を変えない（実 DB）", () => {
  test.each(PROBES.map((probe) => [probe.route, probe.name, probe] as const))(
    "%s（%s）",
    async (_route, _name, probe) => {
      const db = getDb();
      // 前後のスナップショットを同じ時点の DB から読む。既定の READ COMMITTED だと、同じ DB に別の
      // プロセス（e2e の dev サーバー等）がその間にコミットした行まで見え、無関係な行の差分で落ちる。
      // トランザクションの最初の文でなければ効かないので、シードより前に置く
      await db.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      const seeded = await seed(db);
      const app = buildActorApp(db, seeded.actor.id);
      const { path, body } = probe.request(seeded);
      const [method] = probe.route.split(" ");

      const before = await snapshot(db);
      const res = await app.request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const after = await snapshot(db);

      expect(res.status).toBe(probe.status);
      expect(findViolations(before, after, seeded.actor.id, probe.allowed(seeded))).toEqual([]);
    },
  );
});

describe("網羅性: 更新系ルートはすべてこのテストで叩くか、理由付きで除外する", () => {
  const routes = mutatingRoutes();
  const probed = new Set(PROBES.map((probe) => probe.route));

  test("更新系ルートを見つけられている（ルート一覧の取り方が壊れていない）", () => {
    expect(routes).toContain("POST /api/tasks");
    expect(routes).toContain("DELETE /api/tasks/:id");
  });

  test("叩いていない更新系ルートが無い", () => {
    const missing = routes.filter(
      (key) =>
        !probed.has(key) &&
        !EXCLUDED_ROUTES.some(({ path }) => path.test(key.slice(key.indexOf(" ") + 1))),
    );
    expect(missing).toEqual([]);
  });

  test("PROBES のルートはすべて実在する（ルートの改名で網が外れていない）", () => {
    expect([...probed].filter((key) => !routes.includes(key))).toEqual([]);
  });
});
