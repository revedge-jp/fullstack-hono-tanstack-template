// actions / queries のテストが毎回手書きしていたモック雛形
// (`let mockOk / mockBody / lastJson` + `mock.module("hono/client", ...)`)の共通化。
// 放置すると雛形が feature の数だけ写経されるため、書き始めを import + 2行に保つ(.claude/rules/client.md)。
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
  // 設定すると呼び出し自体がこの値で reject する（fetch の失敗 = オフライン等の再現）
  callError: unknown;
  // true にすると json() が reject する（JSON でない本文 = エッジの 502 HTML 等の再現）
  jsonFails: boolean;
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
  callError: undefined,
  jsonFails: false,
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
        if (state.callError !== undefined) {
          return Promise.reject(state.callError);
        }
        return Promise.resolve({
          ok: state.ok,
          status: state.status,
          json: async () => {
            if (state.jsonFails) {
              throw new SyntaxError("Unexpected token '<'");
            }
            return state.body;
          },
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

// createServerFn のチェーン(.validator().handler(fn) / .handler(fn))を、validator を通してから
// ハンドラを呼ぶ関数に置き換える。serverFn を直接呼び出してテストするための最小実装。
// validator を捨てると、入力スキーマの誤り（必須の欠落・型の食い違い）がテストで一度も通らない。
type ServerFnHandler = (ctx: { data?: unknown }) => unknown;

function hasParse(value: unknown): value is { parse: (input: unknown) => unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "parse" in value &&
    typeof value.parse === "function"
  );
}

function validate(validator: unknown, data: unknown): unknown {
  if (hasParse(validator)) {
    return validator.parse(data);
  }
  if (typeof validator === "function") {
    return validator(data);
  }
  return data;
}

export const reactStartModule = () => ({
  createServerFn: () => {
    let validator: unknown;
    const chain = {
      validator: (next: unknown) => {
        validator = next;
        return chain;
      },
      handler:
        (fn: ServerFnHandler) =>
        // 本物の serverFn は Promise を返すので、validator の失敗も reject にする
        async (ctx: { data?: unknown } = {}) =>
          fn({ ...ctx, data: validate(validator, ctx.data) }),
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
