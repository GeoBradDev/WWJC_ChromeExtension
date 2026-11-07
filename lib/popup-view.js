// Popup rendering for a wwjcRequest record. No chrome access, so it can be
// tested in jsdom.

import { INTERRUPTED_MESSAGE, REQUEST_TIMEOUT_MS, STALE_MARGIN_MS } from "./request.js";

// A pending record this far from now (either direction, to survive clock
// jumps) cannot belong to a live request: its worker was killed.
export const STALE_PENDING_MS = REQUEST_TIMEOUT_MS + STALE_MARGIN_MS;

export function isOrphanedPending(record, now) {
  return record?.status === "pending" && Math.abs(now - record.updatedAt) > STALE_PENDING_MS;
}

// Milliseconds until a young pending record counts as orphaned.
export function msUntilStale(record, now) {
  return STALE_PENDING_MS - (now - record.updatedAt) + 1;
}

export const NO_COMMENT_MESSAGE = "No comment received. Try again after selecting text.";
export const LOADING_MESSAGE = "Preparing the comment...";

function show(el, display = "block") {
  el.style.display = display;
}

function hide(el) {
  el.style.display = "none";
}

function hideResult(elements) {
  for (const key of ["reference", "verse", "explanation"]) {
    elements[key].textContent = "";
    hide(elements[key]);
  }
  hide(elements.copyBtn);
}

// Sets the popup DOM for one of four states: no record, pending, done, error.
// An orphaned pending record renders as an interrupted error.
export function renderRequest(record, elements, { now = Date.now } = {}) {
  const { loading, status, selectedText, reference, verse, explanation, copyBtn } = elements;

  if (isOrphanedPending(record, now())) {
    record = { ...record, status: "error", error: INTERRUPTED_MESSAGE };
  }

  hideResult(elements);
  status.textContent = "";
  hide(status);

  if (record && record.selectedText) {
    selectedText.textContent = record.selectedText;
    // Clear the inline display instead of setting one, so the stylesheet's
    // display:-webkit-box (needed for the two-line clamp) applies.
    selectedText.style.removeProperty("display");
  } else {
    selectedText.textContent = "";
    hide(selectedText);
  }

  if (!record) {
    loading.textContent = NO_COMMENT_MESSAGE;
    show(loading);
    return;
  }

  if (record.status === "pending") {
    loading.textContent = LOADING_MESSAGE;
    show(loading);
    return;
  }

  hide(loading);

  if (record.status === "done" && record.result) {
    reference.textContent = record.result.reference;
    show(reference);
    verse.textContent = `“${record.result.verse}”`;
    show(verse);
    explanation.textContent = record.result.explanation;
    show(explanation);
    show(copyBtn, "inline-block");
    return;
  }

  status.textContent = record.error || NO_COMMENT_MESSAGE;
  show(status);
}

export const COPY_LABEL = "Copy to Clipboard";
export const COPIED_LABEL = "Copied";
export const COPIED_MESSAGE = "Copied to clipboard.";
export const COPY_FAILED_MESSAGE = "Could not copy. Select the text above and copy it manually.";
export const COPY_FEEDBACK_MS = 2000;

// Removes Markdown emphasis characters (*, backticks, __) and trims. Other
// punctuation, single underscores, quotes and line breaks are kept.
function clean(value) {
  return String(value ?? "").replace(/[*`]/g, "").replace(/__/g, "").trim();
}

// Plain text that pastes cleanly into reply boxes that do not render
// Markdown: `Reference: "verse"` on one line, the explanation on the next.
export function formatForClipboard(result) {
  return `${clean(result.reference)}: "${clean(result.verse)}"\n${clean(result.explanation)}`;
}

// Writes the result to the clipboard. Resolves true on success and false
// when the clipboard is missing or the write throws or rejects.
export async function copyResult(result, clipboard) {
  try {
    await clipboard.writeText(formatForClipboard(result));
    return true;
  } catch {
    return false;
  }
}

// Sets the copy button label and the status live region for one of
// "idle", "copied" or "failed". The region is never hidden, so it stays in
// the accessibility tree and its text changes are announced.
export function showCopyFeedback(state, { copyBtn, copyStatus }) {
  copyBtn.textContent = state === "copied" ? COPIED_LABEL : COPY_LABEL;
  copyStatus.textContent =
    state === "copied" ? COPIED_MESSAGE : state === "failed" ? COPY_FAILED_MESSAGE : "";
  copyStatus.classList.toggle("status-error", state === "failed");
}
