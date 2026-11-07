import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { API_URL, STORAGE_KEY } from "../lib/request.js";

const good = { reference: "John 3:16", verse: "v", explanation: "e" };

let chrome;
let fetch;

async function loadBackground() {
  vi.resetModules();
  return import("../background.js");
}

// Lets pending promise chains started by listeners settle.
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  chrome = createChromeMock();
  fetch = vi.fn(async () => new Response(JSON.stringify({ raw: good }), { status: 200 }));
  vi.stubGlobal("chrome", chrome);
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("background.js", () => {
  it("registers install, startup, and context menu click listeners at load", async () => {
    await loadBackground();
    expect(chrome.runtime.onInstalled.listeners).toHaveLength(1);
    expect(chrome.runtime.onStartup.listeners).toHaveLength(1);
    expect(chrome.contextMenus.onClicked.listeners).toHaveLength(1);
  });

  it("creates the unchanged context menu and removes the legacy key on install", async () => {
    chrome.storage.local.data.wwjcResponse = { raw: good };
    await loadBackground();

    chrome.runtime.onInstalled.fire({ reason: "update" });
    await flush();

    expect(chrome.contextMenus.create).toHaveBeenCalledWith({
      id: "wwjc-bot",
      title: "What Would Jesus Comment?",
      contexts: ["selection"]
    });
    expect(chrome.storage.local.data.wwjcResponse).toBeUndefined();
  });

  it("recovers a stale pending record and removes the legacy key on startup", async () => {
    await loadBackground();
    chrome.storage.local.data.wwjcResponse = { raw: good };
    chrome.storage.local.data[STORAGE_KEY] = {
      id: "p", status: "pending", selectedText: "x", result: null, error: null, updatedAt: 0
    };

    chrome.runtime.onStartup.fire();
    await flush();

    expect(chrome.storage.local.data.wwjcResponse).toBeUndefined();
    expect(chrome.storage.local.data[STORAGE_KEY].status).toBe("error");
  });

  it("recovers a stale pending record when the module loads", async () => {
    chrome.storage.local.data[STORAGE_KEY] = {
      id: "p", status: "pending", selectedText: "x", result: null, error: null, updatedAt: 0
    };

    await loadBackground();
    await flush();

    expect(chrome.storage.local.data[STORAGE_KEY].status).toBe("error");
  });

  it("runs the request end to end for a click on the menu item with a selection", async () => {
    await loadBackground();

    chrome.contextMenus.onClicked.fire({ menuItemId: "wwjc-bot", selectionText: "  some post  " }, { id: 1 });
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(API_URL);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ text: "some post" });
    expect(chrome.storage.local.data[STORAGE_KEY]).toMatchObject({ status: "done", selectedText: "some post", result: good });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on other menu items or without a selection", async () => {
    await loadBackground();

    chrome.contextMenus.onClicked.fire({ menuItemId: "other", selectionText: "x" }, {});
    chrome.contextMenus.onClicked.fire({ menuItemId: "wwjc-bot", selectionText: "   " }, {});
    chrome.contextMenus.onClicked.fire({ menuItemId: "wwjc-bot" }, {});
    await flush();

    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.storage.local.data[STORAGE_KEY]).toBeUndefined();
  });
});
