import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  getObservedAppVersion,
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

  describe("SSR が Server-Timing で渡したバージョンを基準にする", () => {
    function stubDocumentVersion(serverTiming: unknown[]) {
      return spyOn(performance, "getEntriesByType").mockImplementation((type: string) =>
        type === "navigation"
          ? ([{ entryType: "navigation", serverTiming }] as unknown as PerformanceEntryList)
          : [],
      );
    }

    let spy: ReturnType<typeof stubDocumentVersion> | null = null;
    afterEach(() => {
      spy?.mockRestore();
      spy = null;
    });

    test("開いたまま放置中にデプロイされ、最初の API 応答がもう新しい版なら stale になる", () => {
      spy = stubDocumentVersion([{ name: "app", description: "v1" }]);
      recordAppVersion(responseWithVersion("v2"));
      expect(isStaleVersion()).toBe(true);
    });

    test("SSR と同じ版の応答なら stale にならない", () => {
      spy = stubDocumentVersion([{ name: "app", description: "v1" }]);
      recordAppVersion(responseWithVersion("v1"));
      expect(isStaleVersion()).toBe(false);
      expect(getObservedAppVersion()).toBe("v1");
    });

    test("API 応答の前でも SSR のバージョンを通報用に返す", () => {
      spy = stubDocumentVersion([{ name: "app", description: "v1" }]);
      expect(getObservedAppVersion()).toBe("v1");
    });

    test("Server-Timing が無いブラウザでは最初の API 応答を基準にする", () => {
      spy = stubDocumentVersion([]);
      recordAppVersion(responseWithVersion("v2"));
      expect(isStaleVersion()).toBe(false);
      recordAppVersion(responseWithVersion("v3"));
      expect(isStaleVersion()).toBe(true);
    });
  });
});
