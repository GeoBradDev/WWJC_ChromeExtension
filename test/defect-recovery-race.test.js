import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { INTERRUPTED_MESSAGE, STORAGE_KEY } from "../lib/request.js";

// Defect R1: worker-start recovery was get-then-set with no re-check and
// only acted on records older than 120s.
// - A click that wakes the worker could write its pending record between
//   recovery's get and set; recovery then overwrote it with the old record
//   marked interrupted, and the new request was silently discarded.
// - A pending record found at worker start is orphaned by construction (no
//   request from this worker instance is in flight yet), but one younger
//   than 120s, or dated in the future after a clock change, stayed pending.

const good = { reference: "John 3:16", verse: "v", explanation: "e" };
const READY = "Your comment is ready. Click the icon to view it.";

let chrome;
let fetch;

function orphan(updatedAt) {
  return { id: "old", status: "pending", selectedText: "orphaned post", result: null, error: null, updatedAt };
}

// Runs queued storage operations in call order, letting continuations queue
// more, until nothing is left.
async function settle() {
  for (let i = 0; i < 50; i++) {
    chrome.storage.local.flush();
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function loadBackground() {
  vi.resetModules();
  return import("../background.js");
}

function click(text) {
  chrome.contextMenus.onClicked.fire({ menuItemId: "wwjc-bot", selectionText: text }, { id: 1 });
}

beforeEach(() => {
  fetch = vi.fn(async () => new Response(JSON.stringify({ raw: good }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(initial) {
  chrome = createChromeMock(initial, { deferred: true });
  vi.stubGlobal("chrome", chrome);
}

describe("worker-start recovery", () => {
  it("does not overwrite a request started by the click that woke the worker", async () => {
    setup({ [STORAGE_KEY]: orphan(Date.now() - 300000) });

    await loadBackground();
    click("new post");
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({
      status: "done", selectedText: "new post", result: good
    });
    expect(chrome.notifications.create.mock.calls.map(([o]) => o.message)).toEqual([READY]);
  });

  it("marks a young orphaned pending record as interrupted", async () => {
    setup({ [STORAGE_KEY]: orphan(Date.now() - 10000) });

    await loadBackground();
    await settle();

    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({
      id: "old", status: "error", error: INTERRUPTED_MESSAGE, selectedText: "orphaned post"
    });
  });

  it("marks a future-dated orphaned pending record as interrupted", async () => {
    setup({ [STORAGE_KEY]: orphan(Date.now() + 3600000) });

    await loadBackground();
    await settle();

    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ id: "old", status: "error", error: INTERRUPTED_MESSAGE });
  });

  it("onStartup does not interrupt a request this worker started", async () => {
    setup({});
    let resolveFetch;
    fetch.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));

    await loadBackground();
    await settle();
    click("in flight post");
    await settle();
    chrome.runtime.onStartup.fire();
    await settle();

    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ status: "pending", selectedText: "in flight post" });
    resolveFetch(new Response(JSON.stringify({ raw: good }), { status: 200 }));
    await settle();
    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ status: "done", result: good });
  });
});
