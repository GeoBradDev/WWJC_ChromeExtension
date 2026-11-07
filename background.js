import { LEGACY_STORAGE_KEY, recoverStaleRequest, runCommentRequest } from "./lib/request.js";

// Log that the background script has loaded
console.log("WWJC background script loaded");

const MENU_ID = "wwjc-bot";

function logError(err) {
  console.error("WWJC error:", err);
}

function removeLegacyResult() {
  return chrome.storage.local.remove(LEGACY_STORAGE_KEY).catch(logError);
}

// Handle right-click + selection
export function handleMenuClick(info) {
  if (info.menuItemId !== MENU_ID) return undefined;
  const selectedText = (info.selectionText || "").trim();
  if (!selectedText) return undefined;
  return runCommentRequest(selectedText, { chrome }).catch(logError);
}

// Listeners are registered synchronously at top level so events wake the
// service worker correctly.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "What Would Jesus Comment?",
    contexts: ["selection"]
  });
  removeLegacyResult();
});

chrome.runtime.onStartup.addListener(() => {
  removeLegacyResult();
  recoverStaleRequest({ chrome }).catch(logError);
});

chrome.contextMenus.onClicked.addListener(handleMenuClick);

// The worker may also start without onStartup (woken by an event after being
// stopped), so check for a request a killed worker left pending.
recoverStaleRequest({ chrome }).catch(logError);
