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
    if (!document.body) return;
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.title = "Open Ona for Pylon";
    button.innerHTML = `
      <svg viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M185.417 56.2286C189.257 60.0686 191.726 65.28 191.726 71.3143V120.96C191.726 126.994 189.257 132.206 185.417 136.046L135.771 185.691C131.931 189.806 126.446 192 120.686 192H71.04C65.0057 192 59.7943 189.806 55.68 185.691L6.03428 136.046C2.19428 132.206 0 126.994 0 120.96V71.3143C0 65.28 2.19428 60.0686 6.03428 55.9543L55.68 6.30857C59.7943 2.46857 65.0057 0 71.04 0H120.686C126.446 0 131.931 2.46858 135.771 6.58286L185.417 56.2286ZM146.251 125.131V67.1431C146.251 55.3488 136.651 45.4745 124.857 45.4745H66.8688C54.8002 45.4745 45.2002 55.3488 45.2002 67.1431V125.131C45.2002 136.925 54.8002 146.525 66.8688 146.525H124.857C136.651 146.525 146.251 136.925 146.251 125.131Z" fill="currentColor"/>
      </svg>
    `;

    button.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "openSidePanel" });
    });

    document.body.appendChild(button);
  }

  function installButtonWatchdog() {
    const run = () => {
      if (!document.body) return;
      ensureButton();
      const observer = new MutationObserver(() => {
        if (!document.getElementById(BUTTON_ID)) ensureButton();
      });
      observer.observe(document.body, { childList: true });
    };

    if (document.body) {
      run();
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      window.setTimeout(run, 0);
    }
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

  installButtonWatchdog();
  installLocationListeners();
  reportContext();
})();
