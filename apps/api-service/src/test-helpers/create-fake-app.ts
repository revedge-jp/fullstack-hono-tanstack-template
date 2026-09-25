import { type AppRuntime, buildApp, createRateLimitStores, type RateLimitStores } from "@app/app";
import type { AppConfig } from "@app/config";
import { createActivityService } from "@app/features/activity/application/service";
import type { ActivityService } from "@app/features/activity/application/service";
import type { Activity } from "@app/features/activity/domain/models";
import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { type AuthUser, reconstituteAuthUser } from "@app/features/auth/domain/models";
import { createTasksService } from "@app/features/tasks/application/service";
import type { TasksService } from "@app/features/tasks/application/service";
import type { Task } from "@app/features/tasks/domain/models";
import { createActivityRecorder } from "@app/integrations/composition/activity-recorder";
import type { RequestLogger } from "@app/middlewares/request-logger";
import type { HealthDb } from "@app/routes/health";
import { okAsync } from "neverthrow";

import {
  createInMemoryActivityRepository,
  createInMemoryTasksRepository,
} from "./in-memory-repositories";

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
  // 既定は呼び出しごとに新しいストア（テスト間でカウントを共有しない）。"isolate" は本番と同じ
  // モジュールスコープの共有ストアを使う（作り直しても効くことの検証用。使う側は一意な IP を付ける）。
  rateLimitStores?: RateLimitStores | "isolate";
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

  if (overrides.rateLimitStores === "isolate") {
    return buildApp(config, runtime);
  }
  return buildApp(config, runtime, overrides.rateLimitStores ?? createRateLimitStores());
}
