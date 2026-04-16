// Inject the floating button on Pylon issue pages and keep the background
// worker updated with the current issue context as the SPA navigates.

(function () {
  const BUTTON_ID = "gitpod-sidepanel-trigger";

  function getIssueNumber() {
    const issueNumber = new URLSearchParams(window.location.search).get("issueNumber");
    return /^\d+$/.test(issueNumber || "") ? issueNumber : null;
  }

  function getContext() {
    return {
      url: window.location.href,
      issueNumber: getIssueNumber(),
    };
  }

  function reportContext() {
    chrome.runtime.sendMessage({
      type: "PYLON_CONTEXT",
      context: getContext(),
    });
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.title = "Open Gitpod Side Panel";
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 20V12L16 8L22 12V20L16 24L10 20Z" fill="#fff"/>
      </svg>
    `;

    button.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "openSidePanel" });
    });

    document.body.appendChild(button);
  }

  function installLocationListeners() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const notify = () => {
      window.requestAnimationFrame(() => {
        ensureButton();
        reportContext();
      });
    };

    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      notify();
      return result;
    };

    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      notify();
      return result;
    };

    window.addEventListener("popstate", notify);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "REQUEST_PYLON_CONTEXT") {
      sendResponse({
        type: "PYLON_CONTEXT",
        context: getContext(),
      });
    }
  });

  ensureButton();
  installLocationListeners();
  reportContext();
})();
