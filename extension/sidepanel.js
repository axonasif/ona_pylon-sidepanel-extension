const GITPOD_ORIGIN = "https://app.gitpod.io";
const DEFAULT_REPO_URL = "https://github.com/gitpod-io/gitpod-next";
const searchParams = new URLSearchParams(window.location.search);
const allowExtensionDebugFallback = searchParams.get("dev") === "1";

const port = chrome.runtime.connect({ name: "sidepanel" });

const frame = document.getElementById("gitpod-frame");
const frameShell = document.getElementById("frame-shell");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const toolbarSubtitle = document.getElementById("toolbar-subtitle");
const statusView = document.getElementById("status-view");
const statusEyebrow = document.getElementById("status-eyebrow");
const statusTitle = document.getElementById("status-title");
const statusBody = document.getElementById("status-body");
const statusMeta = document.getElementById("status-meta");
const primaryAction = document.getElementById("primary-action");
const debugJson = document.getElementById("debug-json");
const reloadButton = document.getElementById("btn-reload");
const openButton = document.getElementById("btn-open");

let snapshot = null;
let loadingTimer = null;

const localState = {
  pendingCreateIssue: null,
  currentFrameSrc: null,
  lastActiveIssueNumber: null,
  lastReportedVisualSignature: null,
  lastReportedFrameSignature: null,
};

function buildCreateConversationUrl(issueNumber) {
  const prompt = encodeURIComponent(`work on pylon ${issueNumber}`);
  return `${GITPOD_ORIGIN}/ai?p=${prompt}#${DEFAULT_REPO_URL}`;
}

function normalizeUrl(urlString) {
  try {
    return new URL(urlString).toString();
  } catch {
    return urlString || null;
  }
}

function startLoading(message) {
  loading.classList.remove("hidden");
  loadingText.textContent = message;

  window.clearTimeout(loadingTimer);
  loadingTimer = window.setTimeout(() => {
    if (!loading.classList.contains("hidden")) {
      loadingText.textContent = "Still loading Ona… open Debug below if you need the current panel state.";
    }
  }, 10000);
}

function stopLoading() {
  loading.classList.add("hidden");
  window.clearTimeout(loadingTimer);
}

function showStatusView({ tone = "default", eyebrow, title, body, meta, actionLabel }) {
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
  } else {
    primaryAction.classList.add("hidden");
    primaryAction.textContent = "";
  }
}

function clearFrame() {
  if (frame.src !== "about:blank") {
    frame.src = "about:blank";
  }

  localState.currentFrameSrc = null;
  stopLoading();
}

function getDesiredState() {
  if (!snapshot) {
    return { visualState: "resolving", issueNumber: null, targetUrl: null };
  }

  if (snapshot.activeTabIsPylon === false) {
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
      targetUrl: snapshot.savedConversationUrl,
      reason: "saved",
    };
  }

  if (localState.pendingCreateIssue === issueNumber) {
    return {
      visualState: "loading",
      issueNumber,
      targetUrl: buildCreateConversationUrl(issueNumber),
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

  port.postMessage({
    type: "PANEL_VISUAL_STATE",
    visualState,
    issueNumber,
    currentIframeUrl,
  });
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

  port.postMessage({
    type: "PANEL_FRAME_TARGET",
    visualState,
    issueNumber,
    url,
    reason,
  });
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
  };

  debugJson.textContent = JSON.stringify(debugState, null, 2);
}

function getOpenTargetUrl(desiredState) {
  if (desiredState.visualState === "loading") {
    return snapshot?.currentIframeUrl || desiredState.targetUrl || GITPOD_ORIGIN;
  }

  if (desiredState.issueNumber) {
    return snapshot?.savedConversationUrl || desiredState.targetUrl || buildCreateConversationUrl(desiredState.issueNumber);
  }

  return GITPOD_ORIGIN;
}

function syncToolbar(desiredState) {
  if (desiredState.issueNumber) {
    toolbarSubtitle.textContent = `Issue #${desiredState.issueNumber}`;
  } else if (desiredState.visualState === "not-pylon") {
    toolbarSubtitle.textContent = "Open a Pylon tab to use Ona";
  } else {
    toolbarSubtitle.textContent = "Pick a Pylon issue to begin";
  }

  reloadButton.disabled = desiredState.visualState !== "loading";
  openButton.disabled = false;
}

function render() {
  const desiredState = getDesiredState();

  if (localState.lastActiveIssueNumber !== desiredState.issueNumber) {
    if (
      localState.lastActiveIssueNumber &&
      localState.lastActiveIssueNumber !== desiredState.issueNumber
    ) {
      localState.pendingCreateIssue = null;
      localState.lastReportedFrameSignature = null;
    }
    localState.lastActiveIssueNumber = desiredState.issueNumber;
  }

  syncToolbar(desiredState);

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
    case "create":
      clearFrame();
      showStatusView({
        eyebrow: `Issue #${desiredState.issueNumber}`,
        title: "Create a new Ona conversation",
        body: "No saved Ona conversation exists for this Pylon issue yet.",
        meta: `Repo: ${DEFAULT_REPO_URL}`,
        actionLabel: "Create Ona conversation",
      });
      reportVisualState("create", desiredState.issueNumber, null);
      break;
    case "stale-env":
      clearFrame();
      showStatusView({
        tone: "danger",
        eyebrow: "Environment deleted",
        title: "The saved Ona environment is no longer available",
        body: "The saved environment for this issue appears to have been auto-deleted. Create a fresh Ona conversation to continue.",
        meta: `Issue #${desiredState.issueNumber}`,
        actionLabel: "Create Ona conversation",
      });
      reportVisualState("stale-env", desiredState.issueNumber, null);
      break;
    case "loading": {
      statusView.classList.add("hidden");
      frameShell.classList.remove("hidden");

      if (normalizeUrl(localState.currentFrameSrc) !== normalizeUrl(desiredState.targetUrl)) {
        frame.src = desiredState.targetUrl;
        localState.currentFrameSrc = desiredState.targetUrl;
        startLoading(
          desiredState.reason === "saved"
            ? "Loading the saved Ona conversation…"
            : "Creating a fresh Ona conversation…",
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
}

frame.addEventListener("load", () => {
  localState.currentFrameSrc = frame.src;
  stopLoading();
  renderDebug(getDesiredState());
});

frame.addEventListener("error", (event) => {
  loadingText.textContent = "Failed to load Ona in the side panel. Check the Debug section for the current panel state.";
  console.error("iframe error:", event);
});

primaryAction.addEventListener("click", () => {
  const issueNumber = snapshot?.activeIssueNumber;
  if (!issueNumber) return;

  localState.pendingCreateIssue = issueNumber;
  localState.lastReportedFrameSignature = null;
  render();
});

reloadButton.addEventListener("click", () => {
  if (frame.src === "about:blank") return;

  startLoading("Reloading Ona…");
  frame.src = frame.src;
});

openButton.addEventListener("click", () => {
  const desiredState = getDesiredState();
  window.open(getOpenTargetUrl(desiredState), "_blank");
});

port.onMessage.addListener((message) => {
  if (message?.type !== "SNAPSHOT") return;

  snapshot = message.snapshot;
  if (snapshot?.savedConversationUrl) {
    localState.pendingCreateIssue = null;
  }
  render();
});

port.postMessage({
  type: "PANEL_OPTIONS",
  allowExtensionDebugFallback,
});
port.postMessage({ type: "REQUEST_SNAPSHOT" });
render();
