// Request logic for the WWJC service worker. Pure functions with injected
// dependencies: nothing here touches the chrome global at import time.

export const API_URL = "https://brad-stricherz--wwjd-bot-verse-api.modal.run";
export const STORAGE_KEY = "wwjcRequest";
export const LEGACY_STORAGE_KEY = "wwjcResponse";
export const REQUEST_TIMEOUT_MS = 90000;
export const KEEPALIVE_INTERVAL_MS = 20000;

const RESULT_FIELDS = ["reference", "verse", "explanation"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Validates a fetch Response from the backend.
// Returns { ok: true, result } or { ok: false, error } with a user-facing error.
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
    return { ok: false, error: `The service reported an error: ${String(data.error)}` };
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
