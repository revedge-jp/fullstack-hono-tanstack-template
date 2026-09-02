// actions / queries のテストが毎回手書きしていたモック雛形
// (`let mockOk / mockBody / lastJson` + `mock.module("hono/client", ...)`)の共通化。
//
// 背景: この雛形は放置すると feature の数だけ写経される(派生プロダクトの実測で
// actions テストの21%・queries テストの25%が同一雛形の写経、計4,100行に達した)。
// 行カバレッジゲート(80%)の下では写経テストが閾値を満たす最安の方法になるため、
// ヘルパを先に用意して「書き始めが import + 2行」になる状態を保つ。
//
// 使い方(テストファイル側。`mock.module` は SUT の import より前に、
// テストファイル自身で呼ぶ必要がある — bun:test の制約。戻り値が Promise を含む型なので
// no-floating-promises を満たすため top-level await にする):
//
//   const api = createApiMock();
//   await mock.module("@/shared/lib/browser-api-client", api.browserApiClientModule); // ブラウザ側
//   await mock.module("@/shared/lib/api-client", api.apiClientModule); // SSR 側(serverFn)
//   await mock.module("@tanstack/react-start", reactStartModule);
//   await mock.module("@tanstack/react-start/server", reactStartServerModule());
//   const { createTask } = await import("./create-task");
//
//   beforeEach(() => api.reset());
//   api.state.ok = false;
//   api.state.body = { ok: false, error: "Conflict" };
//   expect(api.state.lastJson).toEqual({ title: "..." });

type ApiMockState = {
  ok: boolean;
  status: number;
  body: unknown;
  // 呼び出しの観測点。最後の呼び出しの内容を記録する。
  lastPath: string | undefined; // 例: "api.tasks.$post"
  lastJson: unknown;
  lastQuery: unknown;
  lastParam: unknown;
  lastHeaders: Record<string, string> | undefined;
};

const initialState = (): ApiMockState => ({
  ok: true,
  status: 200,
  body: undefined,
  lastPath: undefined,
  lastJson: undefined,
  lastQuery: undefined,
  lastParam: undefined,
  lastHeaders: undefined,
});

type CallArgs = { json?: unknown; query?: unknown; param?: unknown };
type CallOpts = { init?: { headers?: Record<string, string> } };

export function createApiMock(overrides: Partial<ApiMockState> = {}) {
  const state: ApiMockState = { ...initialState(), ...overrides };
  const defaults = { ...initialState(), ...overrides };

  // hc<AppType>() が返すクライアントの形を Proxy で再現する。パスに応じた宣言が不要で、
  // どのルート(`client.api.xxx.yyy.$get` 等)でもそのまま動く。`$` 始まりのプロパティを
  // 終端メソッドとして扱い、呼び出し内容を state に記録して Response 相当を返す。
  function buildNode(path: string[]): unknown {
    return new Proxy(() => undefined, {
      get(_target, prop: string | symbol) {
        if (typeof prop !== "string") {
          return undefined;
        }
        return buildNode([...path, prop]);
      },
      apply(_target, _thisArg, args: [CallArgs?, CallOpts?]) {
        const [callArgs, opts] = args;
        state.lastPath = path.join(".");
        state.lastJson = callArgs?.json;
        state.lastQuery = callArgs?.query;
        state.lastParam = callArgs?.param;
        state.lastHeaders = opts?.init?.headers;
        return Promise.resolve({
          ok: state.ok,
          status: state.status,
          json: async () => state.body,
        });
      },
    });
  }

  const client = buildNode([]);

  return {
    state,
    // beforeEach で呼ぶ。createApiMock() に渡した初期値へ戻す(引数でさらに上書き可)。
    reset(next: Partial<ApiMockState> = {}) {
      Object.assign(state, defaults, next);
    },
    // ブラウザ側: actions/queryFn が使う共有シングルトン(shared/lib/browser-api-client)を
    // 差し替える。"hono/client" のモックでは足りない — browserApiClient はモジュール
    // キャッシュされるため、複数テストファイルを同一プロセスで実行すると最初のファイルの
    // モックに束縛されたまま後続ファイルの state 変更が効かなくなる。
    browserApiClientModule: () => ({ browserApiClient: client }),
    // SSR 側: `getApiClient()`(shared/lib/api-client)を差し替える
    apiClientModule: () => ({ getApiClient: () => client }),
  };
}

// createServerFn のチェーン(.validator().handler(fn) / .handler(fn))をハンドラ関数の
// 素通しに置き換える。serverFn を直接呼び出してテストするための最小実装。
export const reactStartModule = () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    };
    return chain;
  },
});

// getRequest() を cookie 付きの固定 Request に差し替える(serverFn の cookie 転送検証用)。
export function reactStartServerModule(cookie = "session=test") {
  return () => ({
    getRequest: () => new Request("http://localhost/", { headers: { cookie } }),
  });
}
