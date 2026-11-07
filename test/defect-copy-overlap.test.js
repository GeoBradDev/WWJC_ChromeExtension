// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChromeMock } from "./chrome-mock.js";
import { STORAGE_KEY } from "../lib/request.js";
import {
  COPIED_LABEL,
  COPIED_MESSAGE,
  COPY_FAILED_MESSAGE,
  COPY_FEEDBACK_MS,
  COPY_LABEL
} from "../lib/popup-view.js";

// Defect: overlapping copy clicks. The feedback timer was cleared only before
// the await, and after it the handler checked only that the record was
// unchanged, not that a newer click had superseded it. So an older click's
// success timer could wipe a newer click's error, and writes settling out of
// order let the older click's outcome overwrite the newer one's.

const html = readFileSync(join(import.meta.dirname, "..", "popup.html"), "utf8");
const good = { reference: "John 3:16", verse: "v", explanation: "e" };
const done = { id: "r", status: "done", selectedText: "post", result: good, error: null, updatedAt: Date.now() };

let chrome;
let writes;

function el(id) {
  return document.getElementById(id);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openPopup() {
  chrome = createChromeMock({ [STORAGE_KEY]: done });
  vi.stubGlobal("chrome", chrome);
  vi.resetModules();
  const handlers = [];
  const add = vi.spyOn(document, "addEventListener").mockImplementation((type, fn) => {
    if (type === "DOMContentLoaded") handlers.push(fn);
  });
  await import("../popup.js");
  add.mockRestore();
  expect(handlers).toHaveLength(1);
  handlers[0](new Event("DOMContentLoaded"));
  await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(el("copyBtn").style.display).not.toBe("none");
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html").documentElement.innerHTML;
  writes = [];
  const writeText = vi.fn(() => {
    const d = deferred();
    writes.push(d);
    return d.promise;
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.stubGlobal("alert", vi.fn());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("overlapping copy clicks", () => {
  it("keeps a newer click's error when an older click's success timer would fire", async () => {
    await openPopup();
    vi.useFakeTimers();
    el("copyBtn").click();
    el("copyBtn").click();
    await flush();
    expect(writes).toHaveLength(2);

    writes[0].resolve();
    await flush();
    writes[1].reject(new Error("denied"));
    await flush();
    expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE);

    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS * 2);
    expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE);
    expect(el("copyStatus").classList.contains("status-error")).toBe(true);
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
  });

  it("ignores an older click's failure that settles after the newer click's success", async () => {
    await openPopup();
    vi.useFakeTimers();
    el("copyBtn").click();
    el("copyBtn").click();
    await flush();

    writes[1].resolve();
    await flush();
    expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);
    writes[0].reject(new Error("denied"));
    await flush();
    expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);
    expect(el("copyStatus").classList.contains("status-error")).toBe(false);
    expect(el("copyBtn").textContent).toBe(COPIED_LABEL);
  });

  it("ignores an older click's success that settles after the newer click's failure", async () => {
    await openPopup();
    vi.useFakeTimers();
    el("copyBtn").click();
    el("copyBtn").click();
    await flush();

    writes[1].reject(new Error("denied"));
    await flush();
    writes[0].resolve();
    await flush();
    expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE);
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);

    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS * 2);
    expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE);
    expect(el("copyStatus").classList.contains("status-error")).toBe(true);
  });

  it("resets a newer click's success on its own schedule, not an older timer's", async () => {
    await openPopup();
    vi.useFakeTimers();
    el("copyBtn").click();
    await flush();
    writes[0].resolve();
    await flush();
    expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);

    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS - 500);
    el("copyBtn").click();
    await flush();
    writes[1].resolve();
    await flush();
    expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);

    // The first click's timer would have fired here.
    await vi.advanceTimersByTimeAsync(1000);
    expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);
    expect(el("copyBtn").textContent).toBe(COPIED_LABEL);

    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS);
    expect(el("copyStatus").textContent).toBe("");
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
  });
});
