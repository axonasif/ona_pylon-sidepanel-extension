// Open the side panel when the extension action (toolbar icon) is clicked.
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Automatically enable the side panel on Pylon issue pages.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;

  if (tab.url.startsWith("https://app.usepylon.com/issues")) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true,
    });
  }
});

// Handle message from content script to open the side panel.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openSidePanel" && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id });
  }
});

// Also handle when a Pylon tab is first activated.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url.startsWith("https://app.usepylon.com/issues")) {
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: "sidepanel.html",
        enabled: true,
      });
    }
  } catch {
    // Tab may not exist yet
  }
});
