// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChromeMock } from "./chrome-mock.js";
import { STORAGE_KEY } from "../lib/request.js";

// Defect R5: popup.js subscribes to storage.onChanged before its initial
// storage.get resolves. If an onChanged(done) arrives before the get reply
// (which still carries the older pending record), the stale get result was
// rendered last and the popup stuck on loading.

const html = readFileSync(join(import.meta.dirname, "..", "popup.html"), "utf8");
const good = { reference: "John 3:16", verse: "v", explanation: "e" };
const pending = { id: "r", status: "pending", selectedText: "post", result: null, error: null, updatedAt: Date.now() };
const done = { ...pending, status: "done", result: good, updatedAt: Date.now() + 1 };

let chrome;

beforeEach(() => {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html").documentElement.innerHTML;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function startPopup() {
  chrome = createChromeMock({ [STORAGE_KEY]: pending }, { deferred: true });
  vi.stubGlobal("chrome", chrome);
  vi.resetModules();
  const handlers = [];
  const add = vi.spyOn(document, "addEventListener").mockImplementation((type, fn) => {
    if (type === "DOMContentLoaded") handlers.push(fn);
  });
  return import("../popup.js").then(() => {
    add.mockRestore();
    // The returned promise settles only after the queued initial get runs.
    return handlers[0](new Event("DOMContentLoaded"));
  });
}

describe("popup initial get versus onChanged", () => {
  it("keeps a result delivered by onChanged before the initial get reply", async () => {
    const init = startPopup();
    await vi.waitFor(() => expect(chrome?.storage.local.queue.length).toBe(1));
    // The initial get is queued but has not replied yet.
    expect(chrome.storage.local.queue.map((op) => op.name)).toEqual(["get"]);

    chrome.storage.onChanged.fire({ [STORAGE_KEY]: { oldValue: pending, newValue: done } }, "local");
    // The get reply still carries the pending record it read earlier.
    chrome.storage.local.flush();
    await init;

    expect(document.getElementById("reference").textContent).toBe("John 3:16");
    expect(document.getElementById("loading").style.display).toBe("none");
  });
});
