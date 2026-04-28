const GITPOD_ORIGIN = "https://app.gitpod.io";
const PYLON_ORIGIN = "https://app.usepylon.com";
const DEFAULT_REPO_URL = "https://github.com/gitpod-io/gitpod-next";
const SIDE_PANEL_MARKER_QUERY_PARAM = "ona_side_panel";
const searchParams = new URLSearchParams(window.location.search);
const allowExtensionDebugFallback = searchParams.get("dev") === "1";

let port = null;
let reconnectTimer = null;

const panelRoot = document.getElementById("panel-root");
const frame = document.getElementById("gitpod-frame");
const frameShell = document.getElementById("frame-shell");
const frameControls = document.getElementById("frame-controls");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const statusView = document.getElementById("status-view");
const statusEyebrow = document.getElementById("status-eyebrow");
const statusTitle = document.getElementById("status-title");
const statusBody = document.getElementById("status-body");
const statusMeta = document.getElementById("status-meta");
const primaryAction = document.getElementById("primary-action");
const secondaryAction = document.getElementById("secondary-action");
const debugJson = document.getElementById("debug-json");
const floatingNotice = document.getElementById("floating-notice");
const reloadButton = document.getElementById("btn-reload");
const openButton = document.getElementById("btn-open");
const debugButton = document.getElementById("btn-debug");
const deleteButton = document.getElementById("btn-delete");

let snapshot = null;
let loadingTimer = null;

const localState = {
  pendingCreateIssue: null,
  pendingCreateTargetUrl: null,
  currentFrameSrc: null,
  lastLoadedFrameUrl: null,
  lastActiveIssueNumber: null,
  lastReportedVisualSignature: null,
  lastReportedFrameSignature: null,
  tagSyncInFlightForIssue: null,
  noticeTimer: null,
  createBootstrapFallbackTimer: null,
  deleteArmed: false,
  deleteArmedTimer: null,
  deleteInFlight: false,
  currentLoadingReason: null,
};

function buildPromptText(issueNumber, variant = "default") {
  if (variant === "custom") {
    return `Context: /pylon ${issueNumber}\n\nAsk: `;
  }

  return `/pylon ${issueNumber}`;
}

function buildCreateConversationUrl(issueNumber, variant = "default") {
  const url = new URL(`${GITPOD_ORIGIN}/ai`);
  url.searchParams.set("p", buildPromptText(issueNumber, variant));
  url.searchParams.set(SIDE_PANEL_MARKER_QUERY_PARAM, "1");
  if (snapshot?.preferredGitpodPrincipal) {
    url.searchParams.set("ona_target_principal", snapshot.preferredGitpodPrincipal);
  }
  url.hash = DEFAULT_REPO_URL;
  return url.toString();
}

function normalizeUrl(urlString) {
  try {
    return new URL(urlString).toString();
  } catch {
    return urlString || null;
  }
}

function decorateGitpodUrl(urlString) {
  if (!isGitpodUrl(urlString)) {
    return urlString || null;
  }

  try {
    const url = new URL(urlString);
    url.searchParams.set(SIDE_PANEL_MARKER_QUERY_PARAM, "1");
    if (snapshot?.preferredGitpodPrincipal) {
      url.searchParams.set("ona_target_principal", snapshot.preferredGitpodPrincipal);
    }
    return url.toString();
  } catch {
    return urlString || null;
  }
}

function stripPanelOnlyGitpodParams(urlString) {
  if (!isGitpodUrl(urlString)) return urlString || null;

  try {
    const url = new URL(urlString);
    url.searchParams.delete(SIDE_PANEL_MARKER_QUERY_PARAM);
    return url.toString();
  } catch {
    return urlString || null;
  }
}

function startLoading(message, reason = "generic") {
  loading.classList.remove("hidden");
  loadingText.textContent = message;
  hideFrameControls();
  localState.currentLoadingReason = reason;
  if (localState.createBootstrapFallbackTimer) {
    window.clearTimeout(localState.createBootstrapFallbackTimer);
    localState.createBootstrapFallbackTimer = null;
  }

  if (reason === "create") {
    localState.createBootstrapFallbackTimer = window.setTimeout(() => {
      if (localState.currentLoadingReason !== "create") return;
      if (!isFrameLoadedForCurrentSrc()) return;
      stopLoading();
      if (isGitpodUrl(frame.src)) {
        showFrameControls();
      }
    }, 15000);
  }

  window.clearTimeout(loadingTimer);
  loadingTimer = window.setTimeout(() => {
    if (!loading.classList.contains("hidden")) {
      loadingText.textContent = "Still loading Ona…";
    }
  }, 10000);
}

function stopLoading() {
  loading.classList.add("hidden");
  window.clearTimeout(loadingTimer);
  if (localState.createBootstrapFallbackTimer) {
    window.clearTimeout(localState.createBootstrapFallbackTimer);
    localState.createBootstrapFallbackTimer = null;
  }
  localState.currentLoadingReason = null;
}

function showFrameControls() {
  frameControls.classList.add("visible");
}

function hideFrameControls() {
  frameControls.classList.remove("visible");
  debugJson.classList.add("hidden");
  debugButton.classList.remove("is-active");
  disarmDelete();
}

function hideNotice() {
  if (localState.noticeTimer) {
    window.clearTimeout(localState.noticeTimer);
    localState.noticeTimer = null;
  }
  floatingNotice.classList.add("hidden");
  floatingNotice.textContent = "";
}

function showNotice(message, durationMs = 9000) {
  if (!message) {
    hideNotice();
    return;
  }
  if (localState.noticeTimer) {
    window.clearTimeout(localState.noticeTimer);
  }
  floatingNotice.textContent = message;
  floatingNotice.classList.remove("hidden");
  localState.noticeTimer = window.setTimeout(() => {
    hideNotice();
  }, durationMs);
}

function isGitpodUrl(url) {
  return typeof url === "string" && url.startsWith(GITPOD_ORIGIN);
}

function extractEnvironmentId(url) {
  try {
    const u = new URL(url);
    if (u.origin !== GITPOD_ORIGIN) return null;
    const match = u.pathname.match(/^\/details\/([^/?#]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getActiveEnvironmentId() {
  return (
    extractEnvironmentId(snapshot?.currentIframeUrl) ||
    extractEnvironmentId(localState.currentFrameSrc)
  );
}

function disarmDelete() {
  localState.deleteArmed = false;
  if (localState.deleteArmedTimer) {
    window.clearTimeout(localState.deleteArmedTimer);
    localState.deleteArmedTimer = null;
  }
  deleteButton.classList.remove("is-armed");
  deleteButton.title = "Delete environment";
}

function updateDeleteButtonState() {
  const envId = getActiveEnvironmentId();
  const canDelete = Boolean(envId) && !localState.deleteInFlight;
  deleteButton.disabled = !canDelete;
  if (!canDelete) disarmDelete();
}

function showStatusView({
  tone = "default",
  eyebrow,
  title,
  body,
  meta,
  actionLabel,
  secondaryActionLabel,
}) {
  statusView.classList.remove("hidden");
  frameShell.classList.add("hidden");
  statusView.dataset.tone = tone;
  statusEyebrow.dataset.tone = tone === "danger" ? "danger" : "default";
  statusEyebrow.textContent = eyebrow;
  statusTitle.textContent = title;
  statusBody.textContent = body;

  if (meta) {
    statusMeta.classList.remove("hidden");
    statusMeta.textContent = meta;
  } else {
    statusMeta.classList.add("hidden");
    statusMeta.textContent = "";
  }

  if (actionLabel) {
    primaryAction.classList.remove("hidden");
    primaryAction.textContent = actionLabel;
    primaryAction.disabled = false;
  } else {
    primaryAction.classList.add("hidden");
    primaryAction.textContent = "";
    primaryAction.disabled = false;
  }

  if (secondaryActionLabel) {
    secondaryAction.classList.remove("hidden");
    secondaryAction.title = secondaryActionLabel;
    secondaryAction.setAttribute("aria-label", secondaryActionLabel);
    secondaryAction.disabled = false;
  } else {
    secondaryAction.classList.add("hidden");
    secondaryAction.title = "";
    secondaryAction.setAttribute("aria-label", "");
    secondaryAction.disabled = false;
  }
}

function clearFrame() {
  if (frame.src !== "about:blank") {
    frame.src = "about:blank";
  }

  localState.currentFrameSrc = null;
  localState.lastLoadedFrameUrl = null;
  stopLoading();
  hideFrameControls();
}

function hasCreateReadySignal() {
  return Boolean(
    snapshot?.gitpodDocumentId &&
      snapshot?.lastProjectEnvironmentClassesEvent?.documentId === snapshot.gitpodDocumentId,
  );
}

function isFrameLoadedForCurrentSrc() {
  return normalizeUrl(localState.lastLoadedFrameUrl) === normalizeUrl(frame.src);
}

function maybeFinishCreateLoading() {
  if (
    localState.currentLoadingReason !== "create" ||
    !hasCreateReadySignal() ||
    !isFrameLoadedForCurrentSrc()
  ) {
    return false;
  }

  stopLoading();
  if (isGitpodUrl(frame.src)) {
    showFrameControls();
  }
  return true;
}

function getDesiredState() {
  if (!snapshot) {
    return { visualState: "resolving", issueNumber: null, targetUrl: null };
  }

  if (snapshot.activeTabIsPylon === false) {
    if (snapshot.reverseIssueNumber) {
      return {
        visualState: "reverse",
        issueNumber: snapshot.reverseIssueNumber,
        targetUrl: snapshot.reversePylonUrl || null,
      };
    }
    const isGitpodTab =
      typeof snapshot.activeTabUrl === "string" &&
      snapshot.activeTabUrl.startsWith(GITPOD_ORIGIN);
    if (isGitpodTab) {
      return { visualState: "gitpod-unlinked", issueNumber: null, targetUrl: null };
    }
    return { visualState: "not-pylon", issueNumber: null, targetUrl: null };
  }

  const issueNumber = snapshot.activeIssueNumber || null;
  const staleEvent = snapshot.lastStaleEvent;
  const hasStaleEvent =
    issueNumber &&
    !snapshot.savedConversationUrl &&
    staleEvent &&
    staleEvent.issueNumber === issueNumber;

  if (!issueNumber) {
    return { visualState: "no-issue", issueNumber: null, targetUrl: null };
  }

  if (snapshot.savedConversationUrl) {
    return {
      visualState: "loading",
      issueNumber,
      targetUrl: decorateGitpodUrl(snapshot.savedConversationUrl),
      reason: "saved",
    };
  }

  if (localState.pendingCreateIssue === issueNumber) {
    return {
      visualState: "loading",
      issueNumber,
      targetUrl: localState.pendingCreateTargetUrl || buildCreateConversationUrl(issueNumber),
      reason: "create",
    };
  }

  if (hasStaleEvent) {
    return {
      visualState: "stale-env",
      issueNumber,
      targetUrl: buildCreateConversationUrl(issueNumber),
    };
  }

  return {
    visualState: "create",
    issueNumber,
    targetUrl: buildCreateConversationUrl(issueNumber),
  };
}

function reportVisualState(visualState, issueNumber, currentIframeUrl) {
  const signature = JSON.stringify({
    visualState,
    issueNumber: issueNumber || null,
    currentIframeUrl: currentIframeUrl || null,
  });

  if (signature === localState.lastReportedVisualSignature) return;
  localState.lastReportedVisualSignature = signature;

  const delivered = postToPort({
    type: "PANEL_VISUAL_STATE",
    visualState,
    issueNumber,
    currentIframeUrl,
  });
  if (!delivered) localState.lastReportedVisualSignature = null;
}

function reportFrameTarget({ visualState, issueNumber, url, reason }) {
  const signature = JSON.stringify({
    visualState,
    issueNumber: issueNumber || null,
    url: url || null,
    reason: reason || null,
  });

  if (signature === localState.lastReportedFrameSignature) return;
  localState.lastReportedFrameSignature = signature;

  const delivered = postToPort({
    type: "PANEL_FRAME_TARGET",
    visualState,
    issueNumber,
    url,
    reason,
  });
  if (!delivered) localState.lastReportedFrameSignature = null;
}

function renderDebug(desiredState) {
  const debugState = {
    visualState: desiredState.visualState,
    repoUrl: DEFAULT_REPO_URL,
    activeTabUrl: snapshot?.activeTabUrl || null,
    activeTabIsPylon: snapshot?.activeTabIsPylon ?? null,
    activePylonUrl: snapshot?.activePylonUrl || null,
    activeIssueNumber: snapshot?.activeIssueNumber || null,
    savedConversationUrl: snapshot?.savedConversationUrl || null,
    preferredGitpodPrincipal: snapshot?.preferredGitpodPrincipal || null,
    currentIframeUrl: snapshot?.currentIframeUrl || null,
    currentFrameSrc: localState.currentFrameSrc,
    expectedFrameUrl: snapshot?.expectedFrameUrl || null,
    pendingConversationCapture: snapshot?.pendingConversationCapture || null,
    lastObservedGitpodUrl: snapshot?.lastObservedGitpodUrl || null,
    lastObservedGitpodSource: snapshot?.lastObservedGitpodSource || null,
    lastCreateUrl: snapshot?.lastCreateUrl || null,
    lastStaleEvent: snapshot?.lastStaleEvent || null,
    lastPylonContextUpdateAt: snapshot?.lastPylonContextUpdateAt || null,
    lastGitpodLocationUpdateAt: snapshot?.lastGitpodLocationUpdateAt || null,
    gitpodDocumentId: snapshot?.gitpodDocumentId || null,
    lastProjectEnvironmentClassesEvent: snapshot?.lastProjectEnvironmentClassesEvent || null,
  };

  debugJson.textContent = JSON.stringify(debugState, null, 2);
}

function getOpenTargetUrl(desiredState) {
  if (desiredState.visualState === "loading") {
    return stripPanelOnlyGitpodParams(
      snapshot?.currentIframeUrl || desiredState.targetUrl || GITPOD_ORIGIN,
    );
  }

  if (desiredState.visualState === "reverse") {
    return desiredState.targetUrl || snapshot?.reversePylonUrl || PYLON_ORIGIN;
  }

  if (desiredState.issueNumber) {
    return (
      stripPanelOnlyGitpodParams(decorateGitpodUrl(snapshot?.savedConversationUrl)) ||
      desiredState.targetUrl ||
      buildCreateConversationUrl(desiredState.issueNumber)
    );
  }

  return GITPOD_ORIGIN;
}

function render() {
  const desiredState = getDesiredState();

  if (localState.lastActiveIssueNumber !== desiredState.issueNumber) {
    if (
      localState.lastActiveIssueNumber &&
      localState.lastActiveIssueNumber !== desiredState.issueNumber
    ) {
      localState.pendingCreateIssue = null;
      localState.pendingCreateTargetUrl = null;
      localState.tagSyncInFlightForIssue = null;
      localState.lastReportedFrameSignature = null;
    }
    localState.lastActiveIssueNumber = desiredState.issueNumber;
  }

  panelRoot.classList.toggle("immersive", desiredState.visualState === "loading");

  switch (desiredState.visualState) {
    case "not-pylon":
      clearFrame();
      showStatusView({
        eyebrow: "Open Pylon",
        title: "The active tab is not a Pylon page",
        body: "Switch to a Pylon tab to use the issue-aware Ona side panel.",
        meta: "Once a Pylon tab is active, the panel will update automatically.",
      });
      reportVisualState("not-pylon", null, null);
      break;
    case "gitpod-unlinked":
      clearFrame();
      showStatusView({
        eyebrow: "Ona on Gitpod",
        title: "No linked Pylon issue",
        body: "This Gitpod page isn't tied to a Pylon thread the extension has seen. Open the related Pylon issue in another tab and the panel will link them automatically.",
      });
      reportVisualState("gitpod-unlinked", null, null);
      break;
    case "reverse":
      clearFrame();
      showStatusView({
        eyebrow: `Pylon issue #${desiredState.issueNumber}`,
        title: "Linked Pylon thread",
        body: "This Ona conversation is linked to a Pylon issue. Pylon's app actively breaks when embedded, so we fall back to a link.",
        meta: desiredState.targetUrl
          ? null
          : "The extension hasn't seen the Pylon thread URL yet. Open the Pylon issue once and it'll remember.",
        actionLabel: desiredState.targetUrl ? "Open Pylon thread" : null,
      });
      reportVisualState("reverse", desiredState.issueNumber, null);
      break;
    case "no-issue":
      clearFrame();
      showStatusView({
        eyebrow: "Pick an issue",
        title: "Open a Pylon issue first",
        body: "This side panel becomes issue-aware when the active Pylon page is showing a specific issue.",
        meta: "When you switch back to an issue, the panel will update automatically.",
      });
      reportVisualState("no-issue", null, null);
      break;
    case "create": {
      clearFrame();
      showStatusView({
        eyebrow: `Issue #${desiredState.issueNumber}`,
        title: "Create a new Ona conversation",
        body: "No saved Ona conversation exists for this Pylon issue yet.",
        meta: `Repo: ${DEFAULT_REPO_URL}`,
        actionLabel: "Create Ona conversation",
        secondaryActionLabel: "Create with editable prompt",
      });
      reportVisualState("create", desiredState.issueNumber, null);
      break;
    }
    case "stale-env": {
      clearFrame();
      showStatusView({
        tone: "danger",
        eyebrow: "Environment deleted",
        title: "The saved Ona environment is no longer available",
        body: "The saved environment for this issue appears to have been auto-deleted. Create a fresh Ona conversation to continue.",
        meta: `Issue #${desiredState.issueNumber}`,
        actionLabel: "Create Ona conversation",
        secondaryActionLabel: "Create with editable prompt",
      });
      reportVisualState("stale-env", desiredState.issueNumber, null);
      break;
    }
    case "loading": {
      statusView.classList.add("hidden");
      frameShell.classList.remove("hidden");

      if (normalizeUrl(localState.currentFrameSrc) !== normalizeUrl(desiredState.targetUrl)) {
        localState.lastLoadedFrameUrl = null;
        frame.src = desiredState.targetUrl;
        localState.currentFrameSrc = desiredState.targetUrl;
        startLoading(
          desiredState.reason === "saved"
            ? "Loading the saved Ona conversation…"
            : "Creating a fresh Ona conversation…",
          desiredState.reason === "saved" ? "saved" : "create",
        );
      }

      reportFrameTarget({
        visualState: "loading",
        issueNumber: desiredState.issueNumber,
        url: desiredState.targetUrl,
        reason: desiredState.reason,
      });
      reportVisualState(
        "loading",
        desiredState.issueNumber,
        snapshot?.currentIframeUrl || localState.currentFrameSrc,
      );
      break;
    }
    case "resolving":
    default:
      clearFrame();
      showStatusView({
        eyebrow: "Resolving",
        title: "Preparing Ona",
        body: "Checking the active Pylon issue and your saved Ona state.",
      });
      reportVisualState("resolving", null, null);
      break;
  }

  renderDebug(desiredState);
  updateDeleteButtonState();
  if (desiredState.visualState === "loading") {
    maybeFinishCreateLoading();
  }
}

frame.addEventListener("load", () => {
  localState.lastLoadedFrameUrl = frame.src;
  localState.currentFrameSrc = frame.src;
  if (localState.currentLoadingReason === "create" && !hasCreateReadySignal()) {
    hideFrameControls();
  } else if (!maybeFinishCreateLoading()) {
    stopLoading();
    if (isGitpodUrl(frame.src)) {
      showFrameControls();
    } else {
      hideFrameControls();
    }
  }
  updateDeleteButtonState();
  renderDebug(getDesiredState());
});

frame.addEventListener("error", (event) => {
  loadingText.textContent = "Failed to load Ona in the side panel.";
  console.error("iframe error:", event);
});

function startCreateFlow(variant = "default") {
  void (async () => {
    const desiredState = getDesiredState();

    if (desiredState.visualState === "reverse" && desiredState.targetUrl) {
      window.open(desiredState.targetUrl, "_blank");
      return;
    }

    const issueNumber = snapshot?.activeIssueNumber;
    if (!issueNumber) return;

    hideNotice();
    render();

    localState.pendingCreateIssue = issueNumber;
    localState.pendingCreateTargetUrl = buildCreateConversationUrl(issueNumber, variant);
    localState.lastReportedFrameSignature = null;
    render();

    if (localState.tagSyncInFlightForIssue === issueNumber) {
      return;
    }

    localState.tagSyncInFlightForIssue = issueNumber;
    chrome.runtime
      .sendMessage({
        type: "ENSURE_ONA_AI_TAG_FOR_ACTIVE_ISSUE",
      })
      .then((response) => {
        if (response?.ok) return;
        throw new Error(response?.error || "ensure-ona-ai-tag-failed");
      })
      .catch((error) => {
        if (snapshot?.activeIssueNumber !== issueNumber) return;
        showNotice(
          `Couldn't add the "ona_ai" tag automatically. Please add it manually in Pylon if needed. (${error?.message || error})`,
        );
      })
      .finally(() => {
        if (localState.tagSyncInFlightForIssue === issueNumber) {
          localState.tagSyncInFlightForIssue = null;
        }
      });
  })();
}

primaryAction.addEventListener("click", () => {
  startCreateFlow("default");
});

secondaryAction.addEventListener("click", () => {
  startCreateFlow("custom");
});

reloadButton.addEventListener("click", () => {
  if (frame.src === "about:blank") return;

  startLoading("Reloading Ona…");
  localState.lastLoadedFrameUrl = null;
  frame.src = frame.src;
});

openButton.addEventListener("click", () => {
  const desiredState = getDesiredState();
  window.open(getOpenTargetUrl(desiredState), "_blank");
});

debugButton.addEventListener("click", () => {
  const hidden = debugJson.classList.toggle("hidden");
  debugButton.classList.toggle("is-active", !hidden);
});

const pendingDeleteRequests = new Map();

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  if (event.origin !== GITPOD_ORIGIN) return;
  const data = event.data;
  if (!data || data.type !== "ONA_DELETE_ENVIRONMENT_RESULT") return;
  const resolver = pendingDeleteRequests.get(data.requestId);
  if (!resolver) return;
  pendingDeleteRequests.delete(data.requestId);
  resolver(data);
});

function requestDeleteFromIframe(envId) {
  return new Promise((resolve, reject) => {
    if (!frame.contentWindow) {
      reject(new Error("iframe-not-available"));
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = window.setTimeout(() => {
      if (pendingDeleteRequests.has(requestId)) {
        pendingDeleteRequests.delete(requestId);
        reject(new Error("timeout"));
      }
    }, 15000);
    pendingDeleteRequests.set(requestId, (result) => {
      window.clearTimeout(timer);
      resolve(result);
    });
    frame.contentWindow.postMessage(
      {
        type: "ONA_DELETE_ENVIRONMENT",
        requestId,
        environmentId: envId,
        principal: snapshot?.gitpodPrincipal || null,
      },
      GITPOD_ORIGIN,
    );
  });
}

deleteButton.addEventListener("click", async () => {
  const envId = getActiveEnvironmentId();
  if (!envId || localState.deleteInFlight) return;

  if (!localState.deleteArmed) {
    localState.deleteArmed = true;
    deleteButton.classList.add("is-armed");
    deleteButton.title = "Click again to confirm delete";
    showNotice("Click delete again within 5 seconds to remove this Ona environment.", 5000);
    localState.deleteArmedTimer = window.setTimeout(() => {
      disarmDelete();
    }, 5000);
    return;
  }

  disarmDelete();
  localState.deleteInFlight = true;
  updateDeleteButtonState();
  startLoading("Deleting Ona environment…", "delete");
  showNotice("Deleting environment…", 12000);

  try {
    const result = await requestDeleteFromIframe(envId);
    if (result.ok) {
      localState.pendingCreateIssue = null;
      postToPort({
        type: "ENVIRONMENT_DELETED",
        environmentId: envId,
        issueNumber: snapshot?.activeIssueNumber || null,
      });
    } else {
      console.error("Delete environment failed", result);
      stopLoading();
      loadingText.textContent = `Delete failed${
        result.status ? ` (status ${result.status})` : ""
      }.`;
      showNotice(
        `Delete failed${result.status ? ` (status ${result.status})` : ""}.`,
        9000,
      );
    }
  } catch (error) {
    console.error("Delete environment error", error);
    stopLoading();
    loadingText.textContent = `Delete failed: ${error.message || error}`;
    showNotice(`Delete failed: ${error.message || error}`, 9000);
  } finally {
    localState.deleteInFlight = false;
    updateDeleteButtonState();
  }
});

function postToPort(message) {
  if (!port) return false;
  try {
    port.postMessage(message);
    return true;
  } catch {
    handleDisconnect();
    return false;
  }
}

function handleDisconnect() {
  if (port) {
    try {
      port.disconnect();
    } catch {}
  }
  port = null;
  localState.lastReportedVisualSignature = null;
  localState.lastReportedFrameSignature = null;

  if (reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectToBackground();
  }, 250);
}

function connectToBackground() {
  port = chrome.runtime.connect({ name: "sidepanel" });

  port.onMessage.addListener((message) => {
    if (message?.type !== "SNAPSHOT") return;

    snapshot = message.snapshot;
    if (snapshot?.savedConversationUrl) {
      localState.pendingCreateIssue = null;
      localState.pendingCreateTargetUrl = null;
    }
    render();
  });

  port.onDisconnect.addListener(() => {
    handleDisconnect();
  });

  postToPort({
    type: "PANEL_OPTIONS",
    allowExtensionDebugFallback,
  });
  postToPort({ type: "REQUEST_SNAPSHOT" });
}

connectToBackground();
render();
