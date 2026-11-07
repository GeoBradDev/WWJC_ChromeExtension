import { describe, it, expect, vi, afterEach } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { runCommentRequest, STORAGE_KEY } from "../lib/request.js";

// Defect R2: the supersede check and the final write could let an older
// request A that settles just as a newer request B starts write its result
// over B (or after B's pending write was ordered behind A's final write),
// so the popup showed A's result, A notified "ready", and B could be
// discarded with the badge stuck on "...".
// Defect R7: starting B left A's fetch, keepalive interval, and backend work
// running instead of aborting it.

const READY = "Your comment is ready. Click the icon to view it.";
const resultA = { reference: "A 1:1", verse: "verse A", explanation: "from A" };
const resultB = { reference: "B 2:2", verse: "verse B", explanation: "from B" };

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200 });
}

// fetch whose calls resolve only when the test says so; rejects on abort.
function controllableFetch() {
  const calls = [];
  const fn = vi.fn((url, init) => new Promise((resolve, reject) => {
    calls.push({ resolve, init });
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  return { fn, calls };
}

function recordValues(chrome) {
  const seen = [];
  chrome.storage.onChanged.addListener((changes) => {
    if (STORAGE_KEY in changes) seen.push(changes[STORAGE_KEY].newValue);
  });
  return seen;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("superseded requests", () => {
  it("an older request settling as a newer one starts never shows or notifies", async () => {
    const chrome = createChromeMock({}, { deferred: true });
    const seen = recordValues(chrome);
    const { fn: fetch, calls } = controllableFetch();
    let n = 0;
    const deps = { chrome, fetch, newId: () => `id-${++n}`, now: () => 1 };
    const settle = async () => {
      for (let i = 0; i < 30; i++) {
        chrome.storage.local.flush();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const a = runCommentRequest("post A", deps);
    await settle();
    expect(calls).toHaveLength(1);

    // A's response arrives; let A reach its final storage check, unflushed.
    calls[0].resolve(jsonResponse({ raw: resultA }));
    await vi.waitFor(() => expect(chrome.storage.local.queue.map((op) => op.name)).toContain("get"));

    // B starts before A's final check has replied.
    const b = runCommentRequest("post B", deps);
    await settle();
    expect(calls).toHaveLength(2);
    calls[1].resolve(jsonResponse({ raw: resultB }));
    await settle();
    await Promise.all([a, b]);

    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ id: "id-2", status: "done", result: resultB });
    expect(seen.some((r) => r?.result?.reference === "A 1:1")).toBe(false);
    expect(chrome.notifications.create.mock.calls.map(([o]) => o.message)).toEqual([READY]);
    expect(chrome.action.setBadgeText.mock.calls.at(-1)[0]).toEqual({ text: "" });
  });

  it("starting a newer request aborts the older fetch and stops its keepalive", async () => {
    vi.useFakeTimers();
    const chrome = createChromeMock();
    const seen = recordValues(chrome);
    const { fn: fetch, calls } = controllableFetch();
    let n = 0;
    const deps = { chrome, fetch, newId: () => `id-${++n}`, now: () => 1 };

    const a = runCommentRequest("post A", deps);
    await vi.advanceTimersByTimeAsync(1000);
    const b = runCommentRequest("post B", deps);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls[1].init.signal.aborted).toBe(false);

    // Only B's keepalive remains: one call at B's 20s mark, none from A.
    await vi.advanceTimersByTimeAsync(20000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(1);

    calls[1].resolve(jsonResponse({ raw: resultB }));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([a, b]);

    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ id: "id-2", status: "done", result: resultB });
    expect(seen.filter((r) => r?.status === "error")).toEqual([]);
    expect(chrome.notifications.create.mock.calls.map(([o]) => o.message)).toEqual([READY]);
  });
});
