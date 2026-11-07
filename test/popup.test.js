// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChromeMock } from "./chrome-mock.js";
import {
  COPIED_LABEL,
  COPIED_MESSAGE,
  COPY_FAILED_MESSAGE,
  COPY_FEEDBACK_MS,
  COPY_LABEL,
  copyResult,
  formatForClipboard,
  renderRequest,
  showCopyFeedback
} from "../lib/popup-view.js";
import { STORAGE_KEY } from "../lib/request.js";

const html = readFileSync(join(import.meta.dirname, "..", "popup.html"), "utf8");
const good = { reference: "John 3:16", verse: "For God so loved the world", explanation: "Love wins." };
const older = { reference: "Old 1:1", verse: "Old verse text", explanation: "Old explanation." };
const sample = {
  reference: "Matthew 22:39",
  verse: "And the second is like it: Love your neighbor as yourself.",
  explanation: "Jesus teaches us to treat others with the care we give ourselves."
};
const goodText = 'John 3:16: "For God so loved the world"\nLove wins.';
const MARKDOWN = /[*`]|__/;

function rec(status, extra = {}) {
  return { id: "r", status, selectedText: "the selected post", result: null, error: null, updatedAt: Date.now(), ...extra };
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

  it("copies the current result as plain text and shows inline feedback, no alert", async () => {
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE));
    expect(writeText).toHaveBeenCalledWith(goodText);
    expect(el("copyBtn").textContent).toBe(COPIED_LABEL);
    expect(el("copyStatus").classList.contains("status-error")).toBe(false);
    expect(el("copyStatus").style.display).not.toBe("none");
    expect(alert).not.toHaveBeenCalled();
  });

  it("copies only the newest result, once, after the record changes", async () => {
    await openPopup(rec("done", { result: older }));
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("pending") });
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("done", { result: good }) });
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(goodText);
    expect(alert).not.toHaveBeenCalled();
  });

  it("resets the label and clears the status after COPY_FEEDBACK_MS", async () => {
    await openPopup(rec("done", { result: good }));
    vi.useFakeTimers();
    try {
      el("copyBtn").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(el("copyBtn").textContent).toBe(COPIED_LABEL);
      expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);
      await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS - 1);
      expect(el("copyBtn").textContent).toBe(COPIED_LABEL);
      await vi.advanceTimersByTimeAsync(1);
      expect(el("copyBtn").textContent).toBe(COPY_LABEL);
      expect(el("copyStatus").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a visible error when writeText rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE));
    expect(el("copyStatus").classList.contains("status-error")).toBe(true);
    expect(el("copyStatus").style.display).not.toBe("none");
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
    expect(alert).not.toHaveBeenCalled();
  });

  it("shows a visible error when writeText throws synchronously", async () => {
    writeText.mockImplementation(() => {
      throw new Error("sync");
    });
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE));
    expect(el("copyStatus").classList.contains("status-error")).toBe(true);
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
  });

  it("shows a visible error when navigator.clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE));
    expect(el("copyStatus").classList.contains("status-error")).toBe(true);
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
  });

  it("keeps the error until the next copy attempt", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE));
    await new Promise((r) => setTimeout(r, 50));
    expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE);
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE));
    expect(el("copyStatus").classList.contains("status-error")).toBe(false);
  });

  it("clears copy feedback when a new record arrives", async () => {
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE));
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("done", { result: older }) });
    expect(el("copyStatus").textContent).toBe("");
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
  });

  it("clears a copy error when a new record arrives", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE));
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("pending") });
    expect(el("copyStatus").textContent).toBe("");
    expect(el("copyStatus").classList.contains("status-error")).toBe(false);
  });

  it("does not show Copied for a result replaced while the write was in flight", async () => {
    let resolveWrite;
    writeText.mockImplementation(() => new Promise((r) => (resolveWrite = r)));
    await openPopup(rec("done", { result: good }));
    el("copyBtn").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    await chrome.storage.local.set({ [STORAGE_KEY]: rec("done", { result: older }) });
    resolveWrite();
    await new Promise((r) => setTimeout(r, 0));
    expect(el("copyStatus").textContent).toBe("");
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
  });

  it("never calls alert in its source", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "popup.js"), "utf8");
    expect(src).not.toMatch(/alert\(/);
  });
});

describe("formatForClipboard", () => {
  it("formats the issue sample as plain text", () => {
    expect(formatForClipboard(sample)).toBe(
      'Matthew 22:39: "And the second is like it: Love your neighbor as yourself."\n' +
        "Jesus teaches us to treat others with the care we give ourselves."
    );
    expect(formatForClipboard(sample)).not.toMatch(MARKDOWN);
  });

  it("strips Markdown emphasis and backticks the backend put in fields", () => {
    const text = formatForClipboard({
      reference: "**Matthew 22:39**",
      verse: "*Love your neighbor* as `yourself`.",
      explanation: "  __Jesus__ teaches **us**.  "
    });
    expect(text).not.toMatch(MARKDOWN);
    expect(text).toBe('Matthew 22:39: "Love your neighbor as yourself."\nJesus teaches us.');
  });

  it("keeps ordinary verse punctuation unchanged", () => {
    const verse = "Thou shalt; love: \"thy\" \u201cneighbour\u201d, \u2018as\u2019 it's well-known snake_case\nsecond line";
    const explanation = "He said: 'go'; it's self-evident_x.\nNext line \u201cquoted\u201d.";
    const text = formatForClipboard({ reference: "Mark 12:31", verse, explanation });
    expect(text).toBe(`Mark 12:31: "${verse}"\n${explanation}`);
  });

  it("tolerates missing fields", () => {
    expect(formatForClipboard({ reference: "Luke 6:31" })).toBe('Luke 6:31: ""\n');
  });
});

describe("copyResult", () => {
  it("writes the formatted text and returns true", async () => {
    const clipboard = { writeText: vi.fn(async () => {}) };
    expect(await copyResult(good, clipboard)).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith(goodText);
  });

  it("returns false when writeText rejects", async () => {
    const clipboard = { writeText: vi.fn(async () => { throw new Error("denied"); }) };
    expect(await copyResult(good, clipboard)).toBe(false);
  });

  it("returns false when writeText throws synchronously", async () => {
    const clipboard = { writeText: vi.fn(() => { throw new Error("sync"); }) };
    expect(await copyResult(good, clipboard)).toBe(false);
  });

  it("returns false when the clipboard is missing", async () => {
    expect(await copyResult(good, undefined)).toBe(false);
  });
});

describe("showCopyFeedback", () => {
  function copyEls() {
    return { copyBtn: el("copyBtn"), copyStatus: el("copyStatus") };
  }

  it("has a status live region in the static popup HTML", () => {
    const status = el("copyStatus");
    expect(status).not.toBeNull();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.style.display).not.toBe("none");
  });

  it("shows Copied and the status message", () => {
    showCopyFeedback("copied", copyEls());
    expect(el("copyBtn").textContent).toBe(COPIED_LABEL);
    expect(el("copyStatus").textContent).toBe(COPIED_MESSAGE);
    expect(el("copyStatus").classList.contains("status-error")).toBe(false);
  });

  it("shows the failure message with the error class", () => {
    showCopyFeedback("failed", copyEls());
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
    expect(el("copyStatus").textContent).toBe(COPY_FAILED_MESSAGE);
    expect(el("copyStatus").classList.contains("status-error")).toBe(true);
  });

  it("returns to idle without hiding the live region", () => {
    showCopyFeedback("failed", copyEls());
    showCopyFeedback("idle", copyEls());
    expect(el("copyBtn").textContent).toBe(COPY_LABEL);
    expect(el("copyStatus").textContent).toBe("");
    expect(el("copyStatus").classList.contains("status-error")).toBe(false);
    expect(el("copyStatus").style.display).not.toBe("none");
  });

  it("uses the agreed wording", () => {
    expect(COPY_LABEL).toBe("Copy to Clipboard");
    expect(COPIED_LABEL).toBe("Copied");
    expect(COPIED_MESSAGE).toBe("Copied to clipboard.");
    expect(COPY_FAILED_MESSAGE).toBe("Could not copy. Select the text above and copy it manually.");
    expect(COPY_FEEDBACK_MS).toBe(2000);
  });
});
