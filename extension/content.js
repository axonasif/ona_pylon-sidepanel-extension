// Inject a floating Gitpod button on Pylon issue pages.
// Clicking it opens the Chrome side panel via the background service worker.

(function () {
  if (document.getElementById("gitpod-sidepanel-trigger")) return;

  const btn = document.createElement("button");
  btn.id = "gitpod-sidepanel-trigger";
  btn.title = "Open Gitpod Side Panel";
  btn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 20V12L16 8L22 12V20L16 24L10 20Z" fill="#fff"/>
    </svg>
  `;

  btn.addEventListener("click", () => {
    // Send message to background to open the side panel
    chrome.runtime.sendMessage({ action: "openSidePanel" });
  });

  document.body.appendChild(btn);
})();
