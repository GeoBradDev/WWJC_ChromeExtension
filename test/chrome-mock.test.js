import { describe, it, expect, vi } from "vitest";
import { createChromeMock } from "./chrome-mock.js";

describe("chrome mock", () => {
  it("stores and reads back values and fires onChanged for local", async () => {
    const chrome = createChromeMock({ a: 1 });
    const seen = vi.fn();
    chrome.storage.onChanged.addListener(seen);

    await chrome.storage.local.set({ b: { x: 2 } });

    expect(await chrome.storage.local.get(["a", "b", "missing"])).toEqual({ a: 1, b: { x: 2 } });
    expect(seen).toHaveBeenCalledWith({ b: { oldValue: undefined, newValue: { x: 2 } } }, "local");
  });

  it("removes keys and reports the removal", async () => {
    const chrome = createChromeMock({ a: 1 });
    const seen = vi.fn();
    chrome.storage.onChanged.addListener(seen);

    await chrome.storage.local.remove("a");

    expect(await chrome.storage.local.get("a")).toEqual({});
    expect(seen).toHaveBeenCalledWith({ a: { oldValue: 1 } }, "local");
  });
});

describe("chrome mock deferred storage", () => {
  it("runs storage operations only when stepped or flushed, in call order", async () => {
    const chrome = createChromeMock({ a: 1 }, { deferred: true });
    const got = chrome.storage.local.get("a");
    const set = chrome.storage.local.set({ a: 2 });
    expect(chrome.storage.local.data.a).toBe(1);
    expect(chrome.storage.local.queue.map((op) => op.name)).toEqual(["get", "set"]);

    expect(chrome.storage.local.step()).toBe("get");
    expect(await got).toEqual({ a: 1 });
    expect(chrome.storage.local.flush()).toEqual(["set"]);
    await set;
    expect(chrome.storage.local.data.a).toBe(2);
  });
});
