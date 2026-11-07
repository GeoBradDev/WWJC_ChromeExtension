// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRequest } from "../lib/popup-view.js";

// Defect R4: showing the selected text set inline display:block, which
// overrode the stylesheet's display:-webkit-box, so -webkit-line-clamp never
// applied and long selections rendered in full.

const html = readFileSync(join(import.meta.dirname, "..", "popup.html"), "utf8");
const ids = ["loading", "status", "selectedText", "reference", "verse", "explanation", "copyBtn"];

function elements() {
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

beforeEach(() => {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html").documentElement.innerHTML;
});

describe("selected text clamping", () => {
  it("the stylesheet clamps .selected-text to two lines", () => {
    const rule = [...document.styleSheets].flatMap((s) => [...s.cssRules])
      .find((r) => r.selectorText === ".selected-text");
    expect(rule.style.display).toBe("-webkit-box");
    expect(rule.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
  });

  for (const record of [
    { id: "r", status: "pending", selectedText: "long ".repeat(200), result: null, error: null, updatedAt: Date.now() },
    { id: "r", status: "done", selectedText: "long ".repeat(200), result: { reference: "a", verse: "b", explanation: "c" }, error: null, updatedAt: Date.now() },
    { id: "r", status: "error", selectedText: "long ".repeat(200), result: null, error: "boom", updatedAt: Date.now() }
  ]) {
    it(`shown selected text uses the clamping display when ${record.status}`, () => {
      renderRequest(record, elements());
      const el = document.getElementById("selectedText");
      expect(getComputedStyle(el).display).toBe("-webkit-box");
    });
  }

  it("selected text is still hidden when there is no record", () => {
    renderRequest(undefined, elements());
    expect(getComputedStyle(document.getElementById("selectedText")).display).toBe("none");
  });
});
