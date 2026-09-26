import { describe, expect, test } from "bun:test";

import { errAsync } from "neverthrow";

import { createFakeApp } from "../../test-helpers/create-fake-app";

// 認証なしで呼べてよい経路。ここに無い経路は、セッションが無ければ必ず 401 を返さなければならない。
// 認証は各ルーターが createAuthedApp + requireAuth を付ける方式（app.ts で /api/* をまとめて守っていない）なので、
// 素の createApp() で書いたルーターや、ハンドラの後に requireAuth を書いた順序の誤りは、どのゲートも通ってしまう。
// ここで実際のルート一覧を回して、付け忘れを落とす。公開してよい経路を足すときは、この一覧に理由を添えて足す。
const PUBLIC_ROUTES: ReadonlyArray<{ path: RegExp; reason: string }> = [
  { path: /^\/$/, reason: "疎通確認" },
  { path: /^\/api\/health(\/live)?$/, reason: "監視（readiness / liveness）" },
  { path: /^\/api\/client-errors$/, reason: "サインイン前の画面のエラーも通報する" },
  { path: /^\/api\/auth\//, reason: "Better Auth（サインイン・コールバック自体）" },
  { path: /^\/api\/dev\//, reason: "開発用サインイン（本番では devAuth が無く 404）" },
];

function concreteRoutes() {
  const app = createFakeApp({ getSession: () => errAsync("Unauthorized" as const) });
  const seen = new Set<string>();
  const routes: Array<{ method: string; path: string }> = [];
  for (const route of app.routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    routes.push({ method: route.method, path: route.path });
  }
  return { app, routes };
}

describe("すべての経路が既定で認証を要求する", () => {
  const { app, routes } = concreteRoutes();
  const protectedRoutes = routes.filter(
    ({ path }) => !PUBLIC_ROUTES.some((publicRoute) => publicRoute.path.test(path)),
  );

  test("守るべき経路を見つけられている（ルート一覧の取り方が壊れていない）", () => {
    const keys = protectedRoutes.map(({ method, path }) => `${method} ${path}`);
    expect(keys).toContain("GET /api/me");
    expect(keys).toContain("POST /api/tasks");
    expect(keys).toContain("PATCH /api/tasks/:id");
    expect(keys).toContain("GET /api/activities");
  });

  test.each(protectedRoutes.map(({ method, path }) => [method, path] as const))(
    "%s %s はセッションが無ければ 401",
    async (method, path) => {
      const concretePath = path
        .replace(/:[A-Za-z]+/g, "00000000-0000-0000-0000-000000000000")
        .replace(/\*$/, "probe");
      // ALL は app.use（ミドルウェア）と app.all（ハンドラ）の両方で出てくる。区別できないので GET で叩き、
      // ハンドラに届かないとき（ミドルウェアだけ・対応するルートが無い）の 404 は許す。2xx などは付け忘れ
      const requestMethod = method === "ALL" ? "GET" : method;
      const res = await app.request(`http://localhost${concretePath}`, {
        method: requestMethod,
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: requestMethod === "GET" || requestMethod === "HEAD" ? undefined : "{}",
      });
      if (method === "ALL") {
        expect([401, 404]).toContain(res.status);
      } else {
        expect(res.status).toBe(401);
      }
    },
  );
});
