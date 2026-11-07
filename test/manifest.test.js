import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { API_URL } from "../lib/request.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// The JS files the extension ships: entry points plus every lib module.
const shippedFiles = [
  "background.js",
  "popup.js",
  ...readdirSync(join(root, "lib"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join("lib", f))
];

// chrome.* namespaces that require a manifest permission, mapped to it.
const GATED = {
  alarms: "alarms",
  bookmarks: "bookmarks",
  contextMenus: "contextMenus",
  cookies: "cookies",
  downloads: "downloads",
  history: "history",
  identity: "identity",
  notifications: "notifications",
  offscreen: "offscreen",
  scripting: "scripting",
  sidePanel: "sidePanel",
  storage: "storage",
  tabs: "tabs",
  webNavigation: "webNavigation",
  webRequest: "webRequest"
};

// chrome.* namespaces usable without any manifest permission.
const UNGATED = new Set(["action", "runtime", "i18n", "extension"]);

function namespacesUsedInCode() {
  const found = new Set();
  for (const file of shippedFiles) {
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(/\bchrome\.([A-Za-z]+)/g)) found.add(match[1]);
  }
  return found;
}

describe("manifest.json", () => {
  it("grants host access only to the API_URL origin", () => {
    expect(
      manifest.host_permissions,
      "host_permissions must be exactly the origin of API_URL plus /*. " +
        "If the backend moves, update manifest.json host_permissions and API_URL in lib/request.js together."
    ).toEqual([new URL(API_URL).origin + "/*"]);
  });

  it("does not request activeTab or host patterns in permissions", () => {
    expect(manifest.permissions).not.toContain("activeTab");
    for (const p of manifest.permissions) {
      expect(p, `host pattern ${p} belongs in host_permissions, not permissions`).not.toMatch(/[:/*<]/);
    }
  });

  it("requests exactly the permissions the shipped code uses", () => {
    const required = new Set();
    for (const ns of namespacesUsedInCode()) {
      if (UNGATED.has(ns)) continue;
      expect(
        Object.hasOwn(GATED, ns),
        `chrome.${ns} is used in code but not classified; add it to GATED or UNGATED in test/manifest.test.js`
      ).toBe(true);
      required.add(GATED[ns]);
    }
    expect([...manifest.permissions].sort()).toEqual([...required].sort());
  });
});
