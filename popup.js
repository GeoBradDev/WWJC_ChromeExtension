document.addEventListener("DOMContentLoaded", () => {
    console.log("Popup loaded");

    const loading = document.getElementById("loading");
    const reference = document.getElementById("reference");
    const verse = document.getElementById("verse");
    const explanation = document.getElementById("explanation");
    const copyBtn = document.getElementById("copyBtn");

    chrome.storage.local.get(["wwjcResponse"], ({ wwjcResponse }) => {
        const raw = wwjcResponse?.raw;

        if (!raw || !raw.reference) {
            loading.textContent = "⛔ No comment received. Try again after selecting text.";
            return;
        }

        // Hide loading text
        loading.style.display = "none";

        // Show and fill in response
        reference.style.display = "block";
        reference.textContent = raw.reference;

        verse.style.display = "block";
        verse.textContent = `“${raw.verse}”`;

        explanation.style.display = "block";
        explanation.textContent = raw.explanation;

        copyBtn.style.display = "inline-block";
        copyBtn.addEventListener("click", () => {
            const textToCopy = `**${raw.reference}**\n*${raw.verse}*\n${raw.explanation}`;
            navigator.clipboard.writeText(textToCopy).then(() => {
                alert("Copied to clipboard!");
            });
        });
    });
});
