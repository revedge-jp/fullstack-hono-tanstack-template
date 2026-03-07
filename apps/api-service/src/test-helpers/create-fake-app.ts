import { Hono } from "hono";
import { createUsersService } from "../features/users/application/service";
import type { UsersRepository } from "../features/users/domain/users.repository";
import { createUsersRouter } from "../features/users/presentation";
import { createInMemoryUsersRepository } from "./users.inmemory.repository";

export { reconstituteUser } from "../features/users/domain/models";
export { createInMemoryUsersRepository } from "./users.inmemory.repository";

export type FakeAppOverrides = {
  usersRepository?: UsersRepository;
};

/**
 * テスト用の最小 Hono アプリを生成する。
 * createInMemoryUsersRepository を使用するため DB 接続不要。
 * hc<AppType>("http://localhost", { fetch: fakeApp.request.bind(fakeApp) }) で
 * フロントエンドの apiClient として差し込める。
 */
export function createFakeApp(overrides: FakeAppOverrides = {}) {
  const usersRepository = overrides.usersRepository ?? createInMemoryUsersRepository();
  const users = createUsersService({ usersRepository });

  const app = new Hono()
    .route("/api/users", createUsersRouter({ users }))
    .get("/", (c) => c.json({ ok: true }));

  return app;
}
