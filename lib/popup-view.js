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

// Same text format the popup has always copied.
export function formatForClipboard(result) {
  return `**${result.reference}**\n*${result.verse}*\n${result.explanation}`;
}
