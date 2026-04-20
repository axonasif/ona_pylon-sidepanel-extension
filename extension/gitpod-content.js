// Report Ona/Gitpod iframe URL changes back to the extension so the panel can
// persist and debug the currently active conversation.

(function () {
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL("")).origin;
  const TARGET_PRINCIPAL_QUERY_PARAM = "ona_target_principal";
  const IS_PANEL_FRAME =
    window.parent !== window &&
    (window.name === "ona-side-panel-frame" ||
      document.referrer.startsWith(chrome.runtime.getURL("")));
  const bootstrapUrl = new URL(window.location.href);
  const bootstrapPrincipal = bootstrapUrl.searchParams.get(TARGET_PRINCIPAL_QUERY_PARAM);

  if (bootstrapPrincipal) {
    try {
      localStorage.setItem("principal", bootstrapPrincipal);
      sessionStorage.setItem("principal", bootstrapPrincipal);
      bootstrapUrl.searchParams.delete(TARGET_PRINCIPAL_QUERY_PARAM);
      history.replaceState(null, "", bootstrapUrl.toString());
    } catch {}
  }

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

  function getCurrentPrincipal() {
    try {
      return localStorage.getItem("principal") || sessionStorage.getItem("principal") || null;
    } catch {
      return null;
    }
  }

  function toPrincipalHeaderValue(principal) {
    if (!principal) return null;
    return principal.includes("/") ? principal : `user/${principal}`;
  }

  function reportLocation() {
    const currentUrl = window.location.href;
    if (currentUrl === lastReportedUrl) return;
    lastReportedUrl = currentUrl;

    chrome.runtime.sendMessage({
      type: "GITPOD_LOCATION",
      url: currentUrl,
      referrer: document.referrer,
      isPanelFrame: IS_PANEL_FRAME,
      principal: getCurrentPrincipal(),
    });
  }

  function installLocationObserver() {
    const notify = () => window.requestAnimationFrame(reportLocation);

    window.addEventListener("popstate", notify);
    window.addEventListener("hashchange", notify);
    window.addEventListener("pageshow", notify);
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", notify);

    const root = document.documentElement || document;
    const observer = new MutationObserver(notify);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    window.setInterval(reportLocation, 500);
  }

  installLocationObserver();
  reportLocation();

  async function fetchAccountContext() {
    const principal = getCurrentPrincipal();
    const headers = {
      accept: "*/*",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      "x-gitpod-client": "web",
    };
    const headerPrincipal = toPrincipalHeaderValue(principal);
    if (headerPrincipal) {
      headers["x-gitpod-principal"] = headerPrincipal;
    }

    const response = await fetch("/api/gitpod.v1.AccountService/GetAccount", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`get-account-failed-${response.status}`);
    }

    const data = await response.json();
    return {
      currentPrincipal: principal,
      memberships: data?.account?.memberships || [],
    };
  }

  function reportAccountContext() {
    fetchAccountContext()
      .then((context) => {
        chrome.runtime.sendMessage({
          type: "GITPOD_ACCOUNT_CONTEXT",
          context,
        });
      })
      .catch(() => {});
  }

  reportAccountContext();

  async function runDeleteEnvironment(environmentId, principal) {
    const effectivePrincipal = toPrincipalHeaderValue(principal || getCurrentPrincipal());
    const headers = {
      "accept": "*/*",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      "x-gitpod-client": "web",
    };
    if (effectivePrincipal) {
      headers["x-gitpod-principal"] = effectivePrincipal;
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
    if (event.origin !== EXTENSION_ORIGIN) return;
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "REQUEST_GITPOD_ACCOUNT_CONTEXT") return;

    fetchAccountContext()
      .then((context) => sendResponse({ ok: true, context }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });
})();
