import { formatForClipboard, renderRequest } from "./lib/popup-view.js";
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
        copyBtn: document.getElementById("copyBtn")
    };

    // The record currently on screen; the copy handler reads it at click
    // time so it never copies a stale result.
    let current;

    function render(record) {
        current = record;
        renderRequest(record, elements);
    }

    elements.copyBtn.addEventListener("click", () => {
        if (current?.status !== "done" || !current.result) return;
        navigator.clipboard.writeText(formatForClipboard(current.result)).then(() => {
            alert("Copied to clipboard!");
        });
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
