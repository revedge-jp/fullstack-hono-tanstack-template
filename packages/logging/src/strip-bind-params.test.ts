import { describe, expect, test } from "bun:test";

import { stripBindParams, stripBindParamsFromStack } from "./strip-bind-params.js";

const QUERY = 'Failed query: insert into "auth_verifications" ("id", "value") values ($1, $2)';

describe("stripBindParams", () => {
  test("`\\nparams:` 以降を切り落とし、SQL 文は残す", () => {
    expect(stripBindParams(`${QUERY}\nparams: id-1,{"codeVerifier":"secret"}`)).toBe(QUERY);
  });

  test("バインド値に改行と `at ` が含まれても末尾まで切り落とす", () => {
    expect(stripBindParams(`${QUERY}\nparams: foo\n    at leaked-secret`)).toBe(QUERY);
  });

  test("マーカーが無ければそのまま返す", () => {
    expect(stripBindParams("boom")).toBe("boom");
  });
});

describe("stripBindParamsFromStack", () => {
  test("メッセージ部分のバインド値だけを切り落とし、フレームは残す", () => {
    const message = `${QUERY}\nparams: id-1,secret`;
    const stack = `Error: ${message}\n    at query (db.ts:1:1)\n    at run (app.ts:2:2)`;
    expect(stripBindParamsFromStack(stack, message)).toBe(
      `Error: ${QUERY}\n    at query (db.ts:1:1)\n    at run (app.ts:2:2)`,
    );
  });

  test("バインド値に改行と `at ` が含まれてもフレームと誤認しない", () => {
    const message = `${QUERY}\nparams: Taro\n    at SECRET-in-param,u1`;
    const stack = `Error: ${message}\n    at query (db.ts:1:1)`;
    const stripped = stripBindParamsFromStack(stack, message);
    expect(stripped).toBe(`Error: ${QUERY}\n    at query (db.ts:1:1)`);
    expect(stripped).not.toContain("SECRET-in-param");
  });

  test("stack 中にメッセージが見つからなければメッセージだけを返す", () => {
    const stack = "Error: rewritten\nparams: secret\n    at run (app.ts:2:2)";
    expect(stripBindParamsFromStack(stack, `${QUERY}\nparams: secret`)).toBe(QUERY);
  });

  test("バインド値が無ければ stack をそのまま返す", () => {
    const stack = "Error: boom\n    at run (app.ts:2:2)";
    expect(stripBindParamsFromStack(stack, "boom")).toBe(stack);
  });
});
