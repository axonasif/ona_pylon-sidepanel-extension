(function () {
  const PROJECT_ENVIRONMENT_CLASSES_PATH =
    "/api/gitpod.v1.ProjectService/ListProjectEnvironmentClasses";
  const BRIDGE_EVENT = "ona-pylon-extension:gitpod-project-environment-classes";
  let didReport = false;

  function matchesTarget(urlString) {
    if (didReport || !urlString) return false;

    try {
      const url = new URL(urlString, window.location.origin);
      return url.origin === window.location.origin && url.pathname === PROJECT_ENVIRONMENT_CLASSES_PATH;
    } catch {
      return false;
    }
  }

  function report(urlString, source) {
    if (!matchesTarget(urlString)) return;
    didReport = true;
    window.postMessage(
      {
        type: BRIDGE_EVENT,
        requestUrl: new URL(urlString, window.location.origin).toString(),
        frameUrl: window.location.href,
        source,
      },
      "*",
    );
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(input, init) {
      const requestUrl = typeof input === "string" ? input : input?.url;
      report(requestUrl, "fetch");
      return originalFetch.call(this, input, init);
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, user, password) {
    this.__onaTrackedUrl = url;
    return originalOpen.call(this, method, url, async, user, password);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    report(this.__onaTrackedUrl, "xhr");
    return originalSend.call(this, body);
  };
})();
