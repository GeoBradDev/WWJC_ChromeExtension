// Request logic for the WWJC service worker. Pure functions with injected
// dependencies: nothing here touches the chrome global at import time.

export const API_URL = "https://brad-stricherz--wwjd-bot-verse-api.modal.run";
export const STORAGE_KEY = "wwjcRequest";
export const LEGACY_STORAGE_KEY = "wwjcResponse";
export const REQUEST_TIMEOUT_MS = 90000;
export const KEEPALIVE_INTERVAL_MS = 20000;

export const BACKEND_ERROR_NOTIFICATION = "The service reported an error. Click the icon for details.";
export const BACKEND_ERROR_GENERIC = "The service reported an error. Please try again.";
export const BACKEND_ERROR_MAX_CHARS = 200;

const RESULT_FIELDS = ["reference", "verse", "explanation"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Validates a fetch Response from the backend.
// Returns { ok: true, result } or { ok: false, error, notification? } with a
// user-facing error; notification, when present, replaces error in the OS
// notification.
export async function parseResult(response) {
  if (!response.ok) {
    return {
      ok: false,
      error: `The service returned an error (HTTP ${response.status}). Please try again.`
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: "The service sent an unreadable response. Please try again." };
  }

  if (data && typeof data === "object" && data.error != null) {
    // Backend text is shown only in the popup, trimmed and capped; the OS
    // notification always uses a fixed message.
    const detail = typeof data.error === "string" ? data.error.trim().slice(0, BACKEND_ERROR_MAX_CHARS) : "";
    return {
      ok: false,
      error: detail ? `The service reported an error: ${detail}` : BACKEND_ERROR_GENERIC,
      notification: BACKEND_ERROR_NOTIFICATION
    };
  }

  const raw = data && typeof data === "object" ? data.raw : undefined;
  if (!raw || typeof raw !== "object" || !RESULT_FIELDS.every((f) => isNonEmptyString(raw[f]))) {
    return { ok: false, error: "The service sent an incomplete response. Please try again." };
  }

  return {
    ok: true,
    result: { reference: raw.reference, verse: raw.verse, explanation: raw.explanation }
  };
}

export const READY_MESSAGE = "Your comment is ready. Click the icon to view it.";
export const TIMEOUT_MESSAGE =
  "The service is warming up or slow, please try again in a moment.";
export const NETWORK_MESSAGE = "Could not reach the service. Check your connection and try again.";

function notify(chrome, message) {
  try {
    const p = chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "WWJC Bot",
      message,
      priority: 1
    });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (err) {
    console.error("WWJC notification error:", err);
  }
}

async function setBadge(chrome, text) {
  try {
    await chrome.action.setBadgeText({ text });
  } catch (err) {
    console.error("WWJC badge error:", err);
  }
}

async function fetchResult(selectedText, { chrome, fetch, apiUrl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Calling an extension API resets the service worker idle timer, so the
  // worker is not terminated while the request is in flight.
  const keepalive = setInterval(() => {
    Promise.resolve(chrome.runtime.getPlatformInfo()).catch(() => {});
  }, KEEPALIVE_INTERVAL_MS);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: selectedText }),
      signal: controller.signal
    });
    const parsed = await parseResult(response);
    if (controller.signal.aborted) return { ok: false, error: TIMEOUT_MESSAGE };
    return parsed;
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: TIMEOUT_MESSAGE };
    console.error("WWJC request error:", err);
    return { ok: false, error: NETWORK_MESSAGE };
  } finally {
    clearTimeout(timeout);
    clearInterval(keepalive);
  }
}

// Every wwjcRequest write (pending write, final check-and-write, recovery)
// runs through this one chain, so each check and its write are atomic
// relative to the others.
let storageChain = Promise.resolve();
function exclusive(fn) {
  const run = storageChain.then(fn);
  storageChain = run.catch(() => {});
  return run;
}

// Ids of requests started by this worker instance. A pending record with any
// other id belongs to a worker that is gone.
const ownRequestIds = new Set();

// Runs one comment request end to end. Writes a pending record (replacing
// any previous one) before fetching, then stores done or error only if this
// request is still the current one. Returns the final record, or null when
// the request was superseded by a newer one.
export async function runCommentRequest(selectedText, deps) {
  const {
    chrome,
    fetch = globalThis.fetch,
    now = Date.now,
    newId = () => crypto.randomUUID(),
    apiUrl = API_URL
  } = deps;
  const id = newId();
  ownRequestIds.add(id);

  // Queued synchronously, so it is ordered after any recovery or final write
  // already queued and before anything queued later.
  await exclusive(async () => {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { id, status: "pending", selectedText, result: null, error: null, updatedAt: now() }
    });
    await setBadge(chrome, "...");
  });

  const outcome = await fetchResult(selectedText, { chrome, fetch, apiUrl });

  return exclusive(async () => {
    const { [STORAGE_KEY]: current } = await chrome.storage.local.get(STORAGE_KEY);
    if (!current || current.id !== id) return null;

    const record = outcome.ok
      ? { id, status: "done", selectedText, result: outcome.result, error: null, updatedAt: now() }
      : { id, status: "error", selectedText, result: null, error: outcome.error, updatedAt: now() };
    await chrome.storage.local.set({ [STORAGE_KEY]: record });
    await setBadge(chrome, outcome.ok ? "" : "!");
    notify(chrome, outcome.ok ? READY_MESSAGE : outcome.notification || outcome.error);
    return record;
  });
}

export const STALE_MARGIN_MS = 30000;
export const INTERRUPTED_MESSAGE = "The request was interrupted, please try again.";

// Run at worker start: a pending record not started by this worker instance
// belongs to a worker that was killed mid-request, whatever its age. Mark it
// as an error so the popup never shows a loading state forever. Serialized
// with request writes, so a click handled after this call is never
// overwritten. STALE_MARGIN_MS is used by the popup's own orphan check.
export function recoverStaleRequest(deps) {
  const { chrome, now = Date.now } = deps;
  return exclusive(async () => {
    const { [STORAGE_KEY]: record } = await chrome.storage.local.get(STORAGE_KEY);
    if (!record || record.status !== "pending" || ownRequestIds.has(record.id)) return;

    await chrome.storage.local.set({
      [STORAGE_KEY]: { ...record, status: "error", result: null, error: INTERRUPTED_MESSAGE, updatedAt: now() }
    });
    await setBadge(chrome, "!");
  });
}
