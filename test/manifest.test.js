// Guards the manifest's permissions and host access against the shipped code.
// The chrome.* usage scan is a regex over source text: bracket access,
// destructuring, or aliasing of chrome are not seen, which fails safe (a
// permission the scan misses must still be justified to stay in the manifest).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { API_URL } from "../lib/request.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const API_ORIGIN_PATTERN = new URL(API_URL).origin + "/*";

// The JS files the extension ships: entry points plus every lib module.
const shippedFiles = [
  "background.js",
  "popup.js",
  ...readdirSync(join(root, "lib"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join("lib", f))
];

// chrome.* namespaces that require a manifest permission, mapped to it.
// tabs is deliberately absent from both lists: most of chrome.tabs (create,
// update, query, sendMessage, onUpdated) needs no permission, and the "tabs"
// permission only exposes the sensitive url, title, favIconUrl and pendingUrl
// Tab fields. Any chrome.tabs use must be classified per the specific usage.
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
  webNavigation: "webNavigation",
  webRequest: "webRequest"
};

// chrome.* namespaces usable without any manifest permission.
const UNGATED = new Set(["action", "runtime", "i18n", "extension"]);

// A permission string that grants host access: <all_urls>, or anything with a
// scheme, path, or wildcard.
const HOST_PATTERN = /[:/*<]/;

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
    ).toEqual([API_ORIGIN_PATTERN]);
  });

  it("does not request activeTab or host patterns in permissions", () => {
    expect(manifest.permissions).not.toContain("activeTab");
    for (const p of manifest.permissions) {
      expect(p, `host pattern ${p} belongs in host_permissions, not permissions`).not.toMatch(HOST_PATTERN);
    }
  });

  it("does not request optional host access", () => {
    for (const key of ["optional_host_permissions", "optional_permissions"]) {
      for (const p of manifest[key] ?? []) {
        expect(
          p,
          `${key} must not contain host patterns such as ${p}; the extension needs host access only to API_URL, ` +
            "which is granted in host_permissions"
        ).not.toMatch(HOST_PATTERN);
      }
    }
  });

  it("injects content scripts only within the API_URL origin", () => {
    for (const script of manifest.content_scripts ?? []) {
      for (const m of script.matches ?? []) {
        expect(
          m,
          `content_scripts matches ${m} reaches beyond ${API_ORIGIN_PATTERN}; ` +
            "content scripts would grant host access the extension does not need"
        ).toMatch(new RegExp("^" + new URL(API_URL).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/"));
      }
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
