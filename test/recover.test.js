import { describe, it, expect } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { recoverStaleRequest, STORAGE_KEY } from "../lib/request.js";

const good = { reference: "John 3:16", verse: "v", explanation: "e" };
const NOW = 1_000_000;

function pendingAt(updatedAt) {
  return { id: "p", status: "pending", selectedText: "post", result: null, error: null, updatedAt };
}

describe("recoverStaleRequest", () => {
  it("marks a pending record older than timeout plus margin as interrupted", async () => {
    const chrome = createChromeMock({ [STORAGE_KEY]: pendingAt(NOW - 120001) });

    await recoverStaleRequest({ chrome, now: () => NOW });

    const record = chrome.storage.local.data[STORAGE_KEY];
    expect(record).toMatchObject({ id: "p", status: "error", selectedText: "post", result: null, updatedAt: NOW });
    expect(record.error).toMatch(/interrupted/i);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
  });

  it("leaves a recent pending record alone", async () => {
    const original = pendingAt(NOW - 60000);
    const chrome = createChromeMock({ [STORAGE_KEY]: original });

    await recoverStaleRequest({ chrome, now: () => NOW });

    expect(chrome.storage.local.data[STORAGE_KEY]).toEqual(original);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("leaves a pending record exactly at the threshold alone", async () => {
    const original = pendingAt(NOW - 120000);
    const chrome = createChromeMock({ [STORAGE_KEY]: original });

    await recoverStaleRequest({ chrome, now: () => NOW });

    expect(chrome.storage.local.data[STORAGE_KEY]).toEqual(original);
  });

  it("leaves old done and error records alone", async () => {
    for (const record of [
      { id: "d", status: "done", selectedText: "x", result: good, error: null, updatedAt: 0 },
      { id: "e", status: "error", selectedText: "x", result: null, error: "bad", updatedAt: 0 }
    ]) {
      const chrome = createChromeMock({ [STORAGE_KEY]: record });
      await recoverStaleRequest({ chrome, now: () => NOW });
      expect(chrome.storage.local.data[STORAGE_KEY]).toEqual(record);
    }
  });

  it("does nothing when there is no record", async () => {
    const chrome = createChromeMock();
    await recoverStaleRequest({ chrome, now: () => NOW });
    expect(chrome.storage.local.data).toEqual({});
  });
});
