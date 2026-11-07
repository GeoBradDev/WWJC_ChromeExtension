// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChromeMock } from "./chrome-mock.js";
import { renderRequest } from "../lib/popup-view.js";
import { STORAGE_KEY } from "../lib/request.js";

const html = readFileSync(join(import.meta.dirname, "..", "popup.html"), "utf8");
const good = { reference: "John 3:16", verse: "For God so loved the world", explanation: "Love wins." };
const older = { reference: "Old 1:1", verse: "Old verse text", explanation: "Old explanation." };

function rec(status, extra = {}) {
  return { id: "r", status, selectedText: "the selected post", result: null, error: null, updatedAt: 1, ...extra };
}

function el(id) {
  return document.getElementById(id);
}

function shown(id) {
  return el(id).style.display !== "none";
}

function elements() {
  const ids = ["loading", "status", "selectedText", "reference", "verse", "explanation", "copyBtn"];
  return Object.fromEntries(ids.map((id) => [id, el(id)]));
}

beforeEach(() => {
  // Scripts in innerHTML do not run, so this only builds the real popup DOM.
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html").documentElement.innerHTML;
});

describe("renderRequest", () => {
  it("shows the no-comment message when there is no record", () => {
    renderRequest(undefined, elements());
    expect(shown("loading")).toBe(true);
    expect(el("loading").textContent).toMatch(/no comment received/i);
    for (const id of ["status", "selectedText", "reference", "verse", "explanation", "copyBtn"]) {
      expect(shown(id)).toBe(false);
    }
  });

  it("shows loading and the selected text while pending", () => {
    renderRequest(rec("pending"), elements());
    expect(shown("loading")).toBe(true);
    expect(el("loading").textContent).toMatch(/preparing the comment/i);
    expect(shown("selectedText")).toBe(true);
    expect(el("selectedText").textContent).toContain("the selected post");
    for (const id of ["status", "reference", "verse", "explanation", "copyBtn"]) {
      expect(shown(id)).toBe(false);
    }
  });

  it("shows the result and copy button when done", () => {
    renderRequest(rec("done", { result: good }), elements());
    expect(shown("loading")).toBe(false);
    expect(shown("status")).toBe(false);
    expect(el("selectedText").textContent).toContain("the selected post");
    expect(el("reference").textContent).toBe("John 3:16");
    expect(el("verse").textContent).toBe("“For God so loved the world”");
    expect(el("explanation").textContent).toBe("Love wins.");
    for (const id of ["reference", "verse", "explanation", "copyBtn"]) {
      expect(shown(id)).toBe(true);
    }
  });

  it("shows the error and hides the verse and copy button on error", () => {
    renderRequest(rec("error", { error: "The service returned an error (HTTP 500)." }), elements());
    expect(shown("status")).toBe(true);
    expect(el("status").textContent).toBe("The service returned an error (HTTP 500).");
    expect(shown("loading")).toBe(false);
    for (const id of ["reference", "verse", "explanation", "copyBtn"]) {
      expect(shown(id)).toBe(false);
    }
  });

  it("never shows a previous verse after an error follows a success", () => {
    const els = elements();
    renderRequest(rec("done", { result: older }), els);
    renderRequest(rec("error", { error: "boom" }), els);
    expect(document.body.textContent).not.toContain("Old verse text");
    expect(document.body.textContent).not.toContain("Old 1:1");
    expect(shown("verse")).toBe(false);
  });

  it("clears a previous error when a new request is pending", () => {
    const els = elements();
    renderRequest(rec("error", { error: "boom" }), els);
    renderRequest(rec("pending"), els);
    expect(shown("status")).toBe(false);
    expect(document.body.textContent).not.toContain("boom");
  });
});

describe("popup.js", () => {
  let chrome;
  let writeText;

  async function openPopup(initial) {
    chrome = createChromeMock(initial ? { [STORAGE_KEY]: initial } : {});
    vi.stubGlobal("chrome", chrome);
    vi.resetModules();
    // Capture this import's DOMContentLoaded handler and run only it, so
    // handlers registered by earlier tests on the shared document never fire.
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
  }

  beforeEach(() => {
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.stubGlobal("alert", vi.fn());
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the stored record when opened", async () => {
    await openPopup(rec("done", { result: good }));
    expect(el("reference").textContent).toBe("John 3:16");
  });

  it("updates from loading to the result without reopening", async () => {
    await openPopup(rec("pending"));
    expect(shown("loading")).toBe(true);
    expect(el("selectedText").textContent).toContain("the selected post");

    await chrome.storage.local.set({ [STORAGE_KEY]: rec("done", { result: good }) });

    expect(shown("loading")).toBe(false);
    expect(el("reference").textContent).toBe("John 3:16");
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
  });

  it("updates from loading to an error without reopening", async () => {
    await openPopup(rec("pending"));
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("error", { error: "boom" }) });
    expect(el("status").textContent).toBe("boom");
    expect(shown("loading")).toBe(false);
  });

  it("ignores changes to other keys and other storage areas", async () => {
    await openPopup(rec("pending"));
    chrome.storage.onChanged.fire({ [STORAGE_KEY]: { newValue: rec("done", { result: good }) } }, "sync");
    await chrome.storage.local.set({ other: 1 });
    expect(shown("loading")).toBe(true);
  });

  it("copies the current result in the existing format and alerts", async () => {
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Copied to clipboard!"));
    expect(writeText).toHaveBeenCalledWith("**John 3:16**\n*For God so loved the world*\nLove wins.");
  });

  it("copies only the newest result, once, after the record changes", async () => {
    await openPopup(rec("done", { result: older }));
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("pending") });
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("done", { result: good }) });
    el("copyBtn").click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("**John 3:16**\n*For God so loved the world*\nLove wins.");
  });
});
