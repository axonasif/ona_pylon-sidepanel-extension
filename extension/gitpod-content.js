// Report Ona/Gitpod iframe URL changes back to the extension so the panel can
// persist and debug the currently active conversation.

(function () {
  let lastReportedUrl = null;

  function reportLocation() {
    const currentUrl = window.location.href;
    if (currentUrl === lastReportedUrl) return;
    lastReportedUrl = currentUrl;

    chrome.runtime.sendMessage({
      type: "GITPOD_LOCATION",
      url: currentUrl,
      referrer: document.referrer,
      isPanelFrame: document.referrer.startsWith(chrome.runtime.getURL("")),
    });
  }

  function installLocationObserver() {
    const notify = () => window.requestAnimationFrame(reportLocation);

    window.addEventListener("popstate", notify);
    window.addEventListener("hashchange", notify);
    window.addEventListener("pageshow", notify);
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", notify);

    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    window.setInterval(reportLocation, 500);
  }

  installLocationObserver();
  reportLocation();
})();
