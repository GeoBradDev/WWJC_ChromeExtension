// Log that the background script has loaded
console.log("WWJC background script loaded");

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  console.log("Registering context menu item...");

  chrome.contextMenus.create({
    id: "wwjc-bot",
    title: "What Would Jesus Comment?",
    contexts: ["selection"]
  });
});

// Handle right-click + selection
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "wwjc-bot" && info.selectionText) {
    const selectedText = info.selectionText.trim();

    // Log the selected text
    console.log("Selected text:", selectedText);

    try {
      // Send POST request to Modal API
      const response = await fetch("https://brad-stricherz--wwjd-bot-verse-api.modal.run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText })
      });

      const data = await response.json();
      console.log("WWJC response:", data);

      console.log("Storing response:", data);
      chrome.storage.local.set({ wwjcResponse: data }, () => {
        console.log("Response saved to chrome.storage");
      });

      // Show notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "WWJC Bot",
        message: "Your comment is ready. Click the icon to view it.",
        priority: 1
      });

    } catch (err) {
      console.error("WWJC error:", err);
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "WWJC Bot",
        message: "Error getting response. Please try again.",
        priority: 1
      });
    }
  }
});
