// Report Ona/Gitpod iframe URL changes back to the extension so the panel can
// persist and debug the currently active conversation.

(function () {
  const IS_PANEL_FRAME =
    window.parent !== window &&
    (window.name === "ona-side-panel-frame" ||
      document.referrer.startsWith(chrome.runtime.getURL("")));

  if (IS_PANEL_FRAME) {
    if (!document.querySelector("style[data-ona-panel]")) {
      const style = document.createElement("style");
      style.setAttribute("data-ona-panel", "true");
      style.textContent = `
        header:has(button[data-testid="environment-header-dropdown-trigger"]),
        div:has(> button[data-testid="environment-header-dropdown-trigger"]) {
          display: none !important;
        }
        div[role="tablist"]:has([data-tracking-id="tab-options"]),
        div[role="tablist"]:has([data-tracking-id="tab-close"]) {
          display: none !important;
        }
      `;
      document.documentElement.appendChild(style);
    }
  }

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

  async function runDeleteEnvironment(environmentId, principal) {
    const headers = {
      "accept": "*/*",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      "x-gitpod-client": "web",
    };
    if (principal) {
      headers["x-gitpod-principal"] = principal;
    }

    const response = await fetch(
      "/api/gitpod.v1.EnvironmentService/DeleteEnvironment",
      {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ environmentId }),
      },
    );
    const result = { ok: response.ok, status: response.status };
    if (!response.ok) {
      try {
        result.body = await response.text();
      } catch {}
    }
    return result;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== "ONA_DELETE_ENVIRONMENT") return;
    const requestId = data.requestId;
    const environmentId = data.environmentId;
    if (!environmentId || !requestId) return;

    runDeleteEnvironment(environmentId, data.principal)
      .then((result) => {
        try {
          event.source.postMessage(
            { type: "ONA_DELETE_ENVIRONMENT_RESULT", requestId, ...result },
            event.origin || "*",
          );
        } catch {}
      })
      .catch((error) => {
        try {
          event.source.postMessage(
            {
              type: "ONA_DELETE_ENVIRONMENT_RESULT",
              requestId,
              ok: false,
              error: String(error),
            },
            event.origin || "*",
          );
        } catch {}
      });
  });
})();
