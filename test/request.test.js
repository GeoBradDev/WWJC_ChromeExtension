import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { runCommentRequest, STORAGE_KEY } from "../lib/request.js";

const good = { reference: "John 3:16", verse: "For God so loved the world", explanation: "Love." };
const READY = "Your comment is ready. Click the icon to view it.";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// fetch mock that resolves with makeResponse() after delayMs of (fake) time,
// and rejects with an AbortError if its signal aborts first.
function delayedFetch(delayMs, makeResponse) {
  return vi.fn((url, init) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(makeResponse()), delayMs);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  }));
}

function notificationMessages(chrome) {
  return chrome.notifications.create.mock.calls.map(([opts]) => opts.message);
}

function badgeTexts(chrome) {
  return chrome.action.setBadgeText.mock.calls.map(([opts]) => opts.text);
}

let ids;
function deps(chrome, fetch, extra = {}) {
  return { chrome, fetch, newId: () => ids.shift(), now: () => 1000, apiUrl: "http://mock.test/api", ...extra };
}

beforeEach(() => {
  vi.useFakeTimers();
  ids = ["id-1", "id-2", "id-3"];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runCommentRequest", () => {
  it("writes a pending record replacing the previous result before fetch is called", async () => {
    const chrome = createChromeMock({
      [STORAGE_KEY]: { id: "old", status: "done", selectedText: "old post", result: good, error: null, updatedAt: 1 }
    });
    let storedAtFetch;
    const fetch = vi.fn(async () => {
      storedAtFetch = structuredClone(chrome.storage.local.data[STORAGE_KEY]);
      return jsonResponse({ raw: good });
    });

    await runCommentRequest("new post", deps(chrome, fetch));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storedAtFetch).toEqual({
      id: "id-1", status: "pending", selectedText: "new post", result: null, error: null, updatedAt: 1000
    });
  });

  it("posts the selected text as JSON to the API URL", async () => {
    const chrome = createChromeMock();
    const fetch = vi.fn(async () => jsonResponse({ raw: good }));

    await runCommentRequest("hello", deps(chrome, fetch));

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://mock.test/api");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ text: "hello" });
  });

  it("stores done with the result, notifies ready, and clears the badge on success", async () => {
    const chrome = createChromeMock();
    const fetch = vi.fn(async () => jsonResponse({ raw: good }));

    await runCommentRequest("post", deps(chrome, fetch));

    expect(chrome.storage.local.data[STORAGE_KEY]).toEqual({
      id: "id-1", status: "done", selectedText: "post", result: good, error: null, updatedAt: 1000
    });
    expect(notificationMessages(chrome)).toEqual([READY]);
    expect(badgeTexts(chrome)).toEqual(["...", ""]);
  });

  const errorCases = [
    ["network failure", () => vi.fn(async () => { throw new TypeError("Failed to fetch"); }), /could not reach/i],
    ["non-2xx status", () => vi.fn(async () => jsonResponse({ raw: good }, 502)), /502/],
    ["2xx body that is not JSON", () => vi.fn(async () => new Response("not json")), /unreadable/i],
    ["2xx JSON error field", () => vi.fn(async () => jsonResponse({ error: "boom" })), /boom/, /reported an error\. Click the icon/],
    ["2xx JSON missing verse", () => vi.fn(async () => jsonResponse({ raw: { reference: "a", explanation: "b" } })), /incomplete/i]
  ];

  for (const [name, makeFetch, pattern, notificationPattern = pattern] of errorCases) {
    it(`stores error and notifies an error, never ready, on ${name}`, async () => {
      const chrome = createChromeMock({
        [STORAGE_KEY]: { id: "old", status: "done", selectedText: "old", result: good, error: null, updatedAt: 1 }
      });

      await runCommentRequest("post", deps(chrome, makeFetch()));

      const record = chrome.storage.local.data[STORAGE_KEY];
      expect(record.status).toBe("error");
      expect(record.id).toBe("id-1");
      expect(record.result).toBeNull();
      expect(record.error).toMatch(pattern);
      const messages = notificationMessages(chrome);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(notificationPattern);
      expect(messages.some((m) => /ready/i.test(m))).toBe(false);
      expect(badgeTexts(chrome)).toEqual(["...", "!"]);
    });
  }

  it("completes a 45s response, keeping the worker alive at 20s and 40s and not after", async () => {
    const chrome = createChromeMock();
    const fetch = delayedFetch(45000, () => jsonResponse({ raw: good }));

    const done = runCommentRequest("slow post", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(19999);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(2);
    expect(chrome.storage.local.data[STORAGE_KEY].status).toBe("pending");
    await vi.advanceTimersByTimeAsync(5000);
    await done;

    expect(chrome.storage.local.data[STORAGE_KEY].status).toBe("done");
    expect(chrome.storage.local.data[STORAGE_KEY].result).toEqual(good);
    expect(notificationMessages(chrome)).toEqual([READY]);

    await vi.advanceTimersByTimeAsync(120000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts after 90s and stores the warming-up timeout error", async () => {
    const chrome = createChromeMock();
    const fetch = delayedFetch(200000, () => jsonResponse({ raw: good }));

    const done = runCommentRequest("post", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(89999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    expect(chrome.storage.local.data[STORAGE_KEY].status).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    const record = chrome.storage.local.data[STORAGE_KEY];
    expect(record.status).toBe("error");
    expect(record.error).toMatch(/warming up or slow/i);
    expect(notificationMessages(chrome)).toHaveLength(1);
    expect(notificationMessages(chrome)[0]).toMatch(/warming up or slow/i);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a body that stalls past the timeout as a timeout", async () => {
    const chrome = createChromeMock();
    // Headers arrive at once; the body never finishes until aborted.
    const fetch = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    }));

    const done = runCommentRequest("post", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(90000);
    await done;

    expect(chrome.storage.local.data[STORAGE_KEY].error).toMatch(/warming up or slow/i);
  });

  it("discards a superseded response without overwriting the newer record or notifying", async () => {
    const chrome = createChromeMock();
    const older = delayedFetch(30000, () => jsonResponse({ raw: { ...good, reference: "Old 1:1" } }));
    const newer = delayedFetch(60000, () => jsonResponse({ raw: good }));
    let call = 0;
    const fetch = vi.fn((...args) => (call++ === 0 ? older(...args) : newer(...args)));

    const first = runCommentRequest("first post", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(1000);
    const second = runCommentRequest("second post", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(29000);
    await first;

    // First settled while second is in flight: nothing changed.
    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ id: "id-2", status: "pending", selectedText: "second post" });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect(badgeTexts(chrome)).toEqual(["...", "..."]);

    await vi.advanceTimersByTimeAsync(60000);
    await second;
    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ id: "id-2", status: "done", result: good });
    expect(notificationMessages(chrome)).toEqual([READY]);
  });

  it("does not let a superseded failure overwrite a newer success", async () => {
    const chrome = createChromeMock();
    let call = 0;
    const fetch = vi.fn((...args) => (call++ === 0
      ? delayedFetch(50000, () => jsonResponse({}, 500))(...args)
      : delayedFetch(10000, () => jsonResponse({ raw: good }))(...args)));

    const first = runCommentRequest("first", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(1000);
    const second = runCommentRequest("second", deps(chrome, fetch));
    await vi.advanceTimersByTimeAsync(60000);
    await Promise.all([first, second]);

    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ id: "id-2", status: "done", result: good });
    expect(notificationMessages(chrome)).toEqual([READY]);
    expect(badgeTexts(chrome)).toEqual(["...", "...", ""]);
  });
});
