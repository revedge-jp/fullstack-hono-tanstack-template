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
  // ルーター全体ではなく /login のハンドラだけが devAuth の有無を見るので、dev ルーターに足した別の経路は守る対象
  { path: /^\/api\/dev\/login$/, reason: "開発用サインイン（本番では devAuth が無く 404）" },
];

const PARAM_CANDIDATES = ["00000000-0000-0000-0000-000000000000", "1", "probe"];

// `:id` と `:id{[0-9]+}` のような制約付きのパラメータを、ルートに当たる値に置き換える。当たらないと 404 になり、
// 守っている経路を付け忘れと誤って落とす
function concretePathOf(path: string) {
  return path
    .replace(/:\w+(\{([^}]*)\})?\??/g, (_match, _braces, constraint: string | undefined) => {
      if (constraint === undefined) {
        return PARAM_CANDIDATES[0];
      }
      const pattern = new RegExp(`^(?:${constraint})$`);
      return PARAM_CANDIDATES.find((candidate) => pattern.test(candidate)) ?? PARAM_CANDIDATES[0];
    })
    .replace(/\*$/, "probe");
}

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
      const concretePath = concretePathOf(path);
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
