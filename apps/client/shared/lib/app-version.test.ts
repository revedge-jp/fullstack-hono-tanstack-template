import { beforeEach, describe, expect, test } from "bun:test";

import {
  isStaleVersion,
  recordAppVersion,
  resetAppVersionForTest,
  subscribeStaleVersion,
} from "./app-version";

function responseWithVersion(version: string | null): Response {
  return new Response(null, {
    headers: version === null ? {} : { "x-app-version": version },
  });
}

describe("shared/lib/app-version", () => {
  beforeEach(() => {
    resetAppVersionForTest();
  });

  test("同じバージョンを見続けている間は stale にならない", () => {
    recordAppVersion(responseWithVersion("v1"));
    recordAppVersion(responseWithVersion("v1"));
    expect(isStaleVersion()).toBe(false);
  });

  test("最初に見たバージョンと異なる値を検知したら stale になりリスナーへ通知する", () => {
    let notified = 0;
    subscribeStaleVersion(() => {
      notified += 1;
    });
    recordAppVersion(responseWithVersion("v1"));
    recordAppVersion(responseWithVersion("v2"));
    expect(isStaleVersion()).toBe(true);
    expect(notified).toBe(1);
  });

  test("stale 後にさらにバージョンが変わっても通知は一度きり", () => {
    let notified = 0;
    subscribeStaleVersion(() => {
      notified += 1;
    });
    recordAppVersion(responseWithVersion("v1"));
    recordAppVersion(responseWithVersion("v2"));
    recordAppVersion(responseWithVersion("v3"));
    expect(notified).toBe(1);
  });

  test("ヘッダが無いレスポンス(外部API等)は無視する", () => {
    recordAppVersion(responseWithVersion(null));
    recordAppVersion(responseWithVersion("v1"));
    recordAppVersion(responseWithVersion(null));
    recordAppVersion(responseWithVersion("v1"));
    expect(isStaleVersion()).toBe(false);
  });

  test("unsubscribe 後は通知されない", () => {
    let notified = 0;
    const unsubscribe = subscribeStaleVersion(() => {
      notified += 1;
    });
    unsubscribe();
    recordAppVersion(responseWithVersion("v1"));
    recordAppVersion(responseWithVersion("v2"));
    expect(isStaleVersion()).toBe(true);
    expect(notified).toBe(0);
  });
});
