// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChromeMock } from "./chrome-mock.js";
import { renderRequest } from "../lib/popup-view.js";
import { INTERRUPTED_MESSAGE, STORAGE_KEY } from "../lib/request.js";

// Defect R3: the popup showed "Preparing the comment..." forever for a
// pending record whose worker was killed, because recovery only runs at
// worker start and opening the popup does not start the worker.
// Threshold: REQUEST_TIMEOUT_MS (90s) + STALE_MARGIN_MS (30s) = 120000 ms.

const html = readFileSync(join(import.meta.dirname, "..", "popup.html"), "utf8");
const ids = ["loading", "status", "selectedText", "reference", "verse", "explanation", "copyBtn"];
const NOW = 10_000_000;
const good = { reference: "John 3:16", verse: "v", explanation: "e" };

function el(id) {
  return document.getElementById(id);
}

function shown(id) {
  return el(id).style.display !== "none";
}

function elements() {
  return Object.fromEntries(ids.map((id) => [id, el(id)]));
}

function pendingAt(updatedAt) {
  return { id: "p", status: "pending", selectedText: "orphaned post", result: null, error: null, updatedAt };
}

function expectInterrupted() {
  expect(shown("loading")).toBe(false);
  expect(shown("status")).toBe(true);
  expect(el("status").textContent).toBe(INTERRUPTED_MESSAGE);
  expect(el("selectedText").textContent).toBe("orphaned post");
}

function expectLoading() {
  expect(shown("loading")).toBe(true);
  expect(el("loading").textContent).toMatch(/preparing the comment/i);
  expect(shown("status")).toBe(false);
}

beforeEach(() => {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html").documentElement.innerHTML;
});

describe("renderRequest with an orphaned pending record", () => {
  it("renders a pending record older than the threshold as interrupted", () => {
    renderRequest(pendingAt(NOW - 120001), elements(), { now: () => NOW });
    expectInterrupted();
  });

  it("renders a pending record dated more than the threshold in the future as interrupted", () => {
    renderRequest(pendingAt(NOW + 120001), elements(), { now: () => NOW });
    expectInterrupted();
  });

  it("still renders a young pending record as loading", () => {
    renderRequest(pendingAt(NOW - 60000), elements(), { now: () => NOW });
    expectLoading();
  });

  it("renders a pending record exactly at the threshold as loading", () => {
    renderRequest(pendingAt(NOW - 120000), elements(), { now: () => NOW });
    expectLoading();
  });
});

describe("popup.js with a young pending record", () => {
  let chrome;

  async function openPopup(record) {
    chrome = createChromeMock({ [STORAGE_KEY]: record });
    vi.stubGlobal("chrome", chrome);
    vi.resetModules();
    const handlers = [];
    const add = vi.spyOn(document, "addEventListener").mockImplementation((type, fn) => {
      if (type === "DOMContentLoaded") handlers.push(fn);
    });
    await import("../popup.js");
    add.mockRestore();
    await handlers[0](new Event("DOMContentLoaded"));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("switches to interrupted when the record becomes stale while open", async () => {
    await openPopup(pendingAt(NOW - 100000));
    expectLoading();

    await vi.advanceTimersByTimeAsync(20000);
    expectLoading();
    await vi.advanceTimersByTimeAsync(1);
    expectInterrupted();
  });

  it("does not switch to interrupted after a newer render replaced the pending record", async () => {
    await openPopup(pendingAt(NOW - 100000));
    await chrome.storage.local.set({
      [STORAGE_KEY]: { ...pendingAt(NOW), status: "done", result: good }
    });

    await vi.advanceTimersByTimeAsync(60000);
    expect(el("reference").textContent).toBe("John 3:16");
    expect(shown("status")).toBe(false);
  });
});
