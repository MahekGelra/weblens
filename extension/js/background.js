// background.js — service worker
// Runs in the background, listens for tab updates

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    chrome.runtime.sendMessage({
      action: "pageUpdated",
      tabId,
      url: tab.url,
    }).catch(() => {
      // Popup may not be open — ignore
    });
  }
});