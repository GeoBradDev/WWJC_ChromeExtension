import {
    COPY_FEEDBACK_MS,
    copyResult,
    isOrphanedPending,
    msUntilStale,
    renderRequest,
    showCopyFeedback
} from "./lib/popup-view.js";
import { STORAGE_KEY } from "./lib/request.js";

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Popup loaded");

    const elements = {
        loading: document.getElementById("loading"),
        status: document.getElementById("status"),
        selectedText: document.getElementById("selectedText"),
        reference: document.getElementById("reference"),
        verse: document.getElementById("verse"),
        explanation: document.getElementById("explanation"),
        copyBtn: document.getElementById("copyBtn"),
        copyStatus: document.getElementById("copyStatus")
    };

    // The record currently on screen; the copy handler reads it at click
    // time so it never copies a stale result.
    let current;
    // Re-renders a young pending record when it would become orphaned, so a
    // killed worker never leaves the popup loading forever.
    let staleTimer;
    // Returns the copy button and status to idle after a successful copy.
    let feedbackTimer;
    // Counts copy clicks so only the latest click's outcome is shown.
    let copyClicks = 0;

    function render(record) {
        clearTimeout(staleTimer);
        clearTimeout(feedbackTimer);
        showCopyFeedback("idle", elements);
        current = record;
        const now = Date.now();
        renderRequest(record, elements, { now: () => now });
        if (record?.status === "pending" && !isOrphanedPending(record, now)) {
            staleTimer = setTimeout(() => render(current), msUntilStale(record, now));
        }
    }

    elements.copyBtn.addEventListener("click", async () => {
        if (current?.status !== "done" || !current.result) return;
        const record = current;
        const click = ++copyClicks;
        clearTimeout(feedbackTimer);
        // Clear first so a repeated message is announced again.
        showCopyFeedback("idle", elements);
        const ok = await copyResult(record.result, navigator.clipboard);
        // A new record arrived during the write (its render already reset
        // the feedback), or a newer click superseded this one: either way
        // this outcome must not be shown.
        if (current !== record || click !== copyClicks) return;
        clearTimeout(feedbackTimer);
        if (ok) {
            showCopyFeedback("copied", elements);
            feedbackTimer = setTimeout(() => showCopyFeedback("idle", elements), COPY_FEEDBACK_MS);
        } else {
            showCopyFeedback("failed", elements);
        }
    });

    // Set once onChanged has rendered: the initial get reply may have been
    // read before that change, so it must not overwrite it.
    let changedSinceOpen = false;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !(STORAGE_KEY in changes)) return;
        changedSinceOpen = true;
        render(changes[STORAGE_KEY].newValue);
    });

    const { [STORAGE_KEY]: record } = await chrome.storage.local.get(STORAGE_KEY);
    if (!changedSinceOpen) render(record);
});
