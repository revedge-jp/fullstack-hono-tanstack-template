import { type AppRuntime, buildApp } from "@app/app";
import type { AppConfig } from "@app/config";
import { createActivityService } from "@app/features/activity/application/service";
import type { ActivityService } from "@app/features/activity/application/service";
import type { ActivityRepository } from "@app/features/activity/domain/activity.repository";
import { type Activity, reconstituteActivity } from "@app/features/activity/domain/models";
import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { type AuthUser, reconstituteAuthUser } from "@app/features/auth/domain/models";
import { createTasksService } from "@app/features/tasks/application/service";
import type { TasksService } from "@app/features/tasks/application/service";
import { type Task, reconstituteTask } from "@app/features/tasks/domain/models";
import type { TasksRepository } from "@app/features/tasks/domain/tasks.repository";
import { createActivityRecorder } from "@app/integrations/composition/activity-recorder";
import type { RequestLogger } from "@app/middlewares/request-logger";
import type { HealthDb } from "@app/routes/health";
import { errAsync, okAsync } from "neverthrow";

// createFakeApp が生成する既定の認証済みユーザー。overrides.user / overrides.getSession で差し替え可能。
const DEFAULT_USER: AuthUser = reconstituteAuthUser({
  id: "fake-user-1",
  email: "fake@example.com",
  name: "Fake User",
});

export type FakeAppOverrides = {
  // --- config 相当 ---
  nodeEnv?: AppConfig["nodeEnv"];
  corsOrigin?: string;
  requestTimeoutMs?: number;
  rateLimit?: { windowMs: number; max: number };
  version?: { appVersion: string; gitSha: string };
  // --- 認証 / セッション ---
  // 既定は「DEFAULT_USER で認証済み」。未認証をテストしたい場合は getSession を差し替える。
  user?: AuthUser;
  getSession?: ReturnType<typeof makeGetSession>;
  // --- サービス（feature 単位で丸ごと差し替え） ---
  tasks?: TasksService;
  activity?: ActivityService;
  // --- 初期データ（既定の in-memory repository へ投入） ---
  seedTasks?: Task[];
  seedActivities?: Activity[];
  // --- インフラ相当 ---
  db?: HealthDb;
  auth?: AppRuntime["auth"];
  logger?: RequestLogger;
};

const silentLogger: RequestLogger = {
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};

function byCreatedDesc(a: Task, b: Task): number {
  const diff = b.createdAt.getTime() - a.createdAt.getTime();
  return diff !== 0 ? diff : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

function createInMemoryTasksRepository(seed: Task[]): TasksRepository {
  const store = new Map<string, Task>(seed.map((t) => [t.id, t]));
  return {
    create: ({ ownerId, title }) => {
      for (const t of store.values()) {
        if (t.ownerId === ownerId && t.title === title) {
          return errAsync("Conflict" as const);
        }
      }
      const now = new Date();
      const task = reconstituteTask({
        id: crypto.randomUUID(),
        ownerId,
        title,
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      store.set(task.id, task);
      return okAsync(task);
    },
    list: ({ ownerId, limit, after }) => {
      let items = [...store.values()].filter((t) => t.ownerId === ownerId).sort(byCreatedDesc);
      if (after) {
        items = items.filter(
          (t) =>
            t.createdAt.getTime() < after.createdAt.getTime() ||
            (t.createdAt.getTime() === after.createdAt.getTime() && t.id < after.id),
        );
      }
      const hasMore = items.length > limit;
      return okAsync({ items: items.slice(0, limit), hasMore });
    },
    getById: (id, ownerId) => {
      const t = store.get(id);
      return okAsync(t && t.ownerId === ownerId ? t : null);
    },
    update: (task) => {
      if (!store.has(task.id)) {
        return errAsync("NotFound" as const);
      }
      store.set(task.id, task);
      return okAsync(task);
    },
    delete: (id, ownerId) => {
      const t = store.get(id);
      if (!t || t.ownerId !== ownerId) {
        return errAsync("NotFound" as const);
      }
      store.delete(id);
      return okAsync(undefined);
    },
  };
}

function createInMemoryActivityRepository(seed: Activity[]): ActivityRepository {
  const store: Activity[] = [...seed];
  return {
    record: ({ ownerId, kind, message }) => {
      const activity = reconstituteActivity({
        id: crypto.randomUUID(),
        ownerId,
        kind,
        message,
        occurredAt: new Date(),
      });
      store.push(activity);
      return okAsync(activity);
    },
    list: ({ ownerId }) =>
      okAsync({
        items: store
          .filter((a) => a.ownerId === ownerId)
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
      }),
  };
}

/**
 * 本物のミドルウェアスタック（app.ts の buildApp）を、DB を必要としない fake 依存で組み立てる
 * テスト用アプリ。zero-config で認証済みの状態で動き、overrides で任意の
 * repository / service / session / config を差し替えられる。
 *
 * 使い方:
 *   const app = createFakeApp();
 *   const client = hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
 *   // または app.request("/api/tasks") を直接叩く
 */
export function createFakeApp(overrides: FakeAppOverrides = {}) {
  const logger = overrides.logger ?? silentLogger;

  const activity =
    overrides.activity ??
    createActivityService({
      activityRepository: createInMemoryActivityRepository(overrides.seedActivities ?? []),
    });

  const tasks =
    overrides.tasks ??
    createTasksService({
      tasksRepository: createInMemoryTasksRepository(overrides.seedTasks ?? []),
      activityRecorder: createActivityRecorder({ activity }),
      logger,
    });

  const user = overrides.user ?? DEFAULT_USER;
  const getSession = overrides.getSession ?? (() => okAsync(user));

  const db: HealthDb = overrides.db ?? { execute: () => Promise.resolve([]) };

  const auth =
    overrides.auth ??
    ({
      handler: () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
    } satisfies AppRuntime["auth"]);

  const runtime: AppRuntime = {
    db,
    logger,
    auth,
    devAuth: undefined,
    getSession,
    tasks,
    activity,
  };

  const config = {
    nodeEnv: overrides.nodeEnv ?? "test",
    corsOrigin: overrides.corsOrigin ?? "http://localhost:3000",
    // 既定は緩め（テストがタイムアウト / レート制限に引っかからないように）。
    requestTimeoutMs: overrides.requestTimeoutMs ?? 30_000,
    rateLimit: overrides.rateLimit ?? { windowMs: 60_000, max: 10_000 },
    version: overrides.version ?? { appVersion: "test", gitSha: "test" },
  } satisfies Pick<
    AppConfig,
    "nodeEnv" | "corsOrigin" | "requestTimeoutMs" | "rateLimit" | "version"
  >;

  return buildApp(config, runtime);
}
