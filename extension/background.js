const GITPOD_ORIGIN = "https://app.gitpod.io";
const DEFAULT_REPO_URL = "https://github.com/gitpod-io/gitpod-next";
const CONVERSATION_STORAGE_KEY = "issueConversationUrls";
const PYLON_URL_STORAGE_KEY = "issuePylonUrls";
const PANEL_PORT_NAME = "sidepanel";
const EXTENSION_ORIGIN = chrome.runtime.getURL("");
const PENDING_CONVERSATION_CAPTURE_MS = 2 * 60 * 1000;

const panelPorts = new Set();
const pylonContexts = new Map();
const gitpodDocuments = new Map();
let lastNonExtensionTabId = null;
let allowExtensionDebugFallback = false;

const panelRuntime = {
  issueNumber: null,
  visualState: "resolving",
  currentIframeUrl: null,
  expectedFrameUrl: null,
  pendingConversationCapture: null,
  lastObservedGitpodUrl: null,
  lastObservedGitpodSource: null,
  lastCreateUrl: null,
  lastStaleEvent: null,
  lastPylonContextUpdateAt: null,
  lastGitpodLocationUpdateAt: null,
  gitpodDocumentId: null,
};

let conversationCache = null;
let pylonUrlCache = null;

function isGitpodDetailsUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.origin === GITPOD_ORIGIN && url.pathname.startsWith("/details/");
  } catch {
    return false;
  }
}

function isPylonAppUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.hostname !== "app.usepylon.com") return false;

    return (
      url.pathname === "/issues" ||
      url.pathname.startsWith("/issues/") ||
      url.pathname.startsWith("/support/issues/")
    );
  } catch {
    return false;
  }
}

function getIssueNumberFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const issueNumber = url.searchParams.get("issueNumber");
    return /^\d+$/.test(issueNumber || "") ? issueNumber : null;
  } catch {
    return null;
  }
}

function buildPylonContext(urlString, source = "background") {
  if (!isPylonAppUrl(urlString)) return null;

  return {
    url: urlString,
    issueNumber: getIssueNumberFromUrl(urlString),
    source,
    updatedAt: Date.now(),
  };
}

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

function isGenericGitpodLandingUrl(urlString) {
  try {
    const url = new URL(urlString);
    return (
      url.origin === GITPOD_ORIGIN &&
      url.pathname === "/ai" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return true;
  }
}

function shouldPersistConversationUrl(urlString, issueNumber) {
  try {
    const url = new URL(urlString);
    if (url.origin !== GITPOD_ORIGIN) return false;
    if (isGenericGitpodLandingUrl(urlString)) return false;
    if (normalizeUrl(urlString) === normalizeUrl(buildCreateConversationUrl(issueNumber))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getActivePendingConversationCapture() {
  const pendingCapture = panelRuntime.pendingConversationCapture;
  if (!pendingCapture) return null;

  if (Date.now() - pendingCapture.startedAt > PENDING_CONVERSATION_CAPTURE_MS) {
    panelRuntime.pendingConversationCapture = null;
    return null;
  }

  return pendingCapture;
}

function beginPendingConversationCapture(issueNumber, createUrl) {
  if (!issueNumber || !createUrl) {
    panelRuntime.pendingConversationCapture = null;
    return;
  }

  panelRuntime.pendingConversationCapture = {
    issueNumber,
    createUrl,
    startedAt: Date.now(),
  };
}

function noteGitpodObservation(urlString, source) {
  panelRuntime.lastObservedGitpodUrl = urlString || null;
  panelRuntime.lastObservedGitpodSource = source || null;
  panelRuntime.lastGitpodLocationUpdateAt = Date.now();
}

async function maybePersistPendingConversationUrl(urlString, source) {
  const pendingCapture = getActivePendingConversationCapture();
  if (!pendingCapture) return false;
  if (!shouldPersistConversationUrl(urlString, pendingCapture.issueNumber)) return false;

  noteGitpodObservation(urlString, source);
  await setConversationForIssue(pendingCapture.issueNumber, urlString);
  panelRuntime.pendingConversationCapture = null;
  panelRuntime.expectedFrameUrl = urlString;
  return true;
}

async function getConversationCache() {
  if (conversationCache) return conversationCache;

  const result = await chrome.storage.local.get(CONVERSATION_STORAGE_KEY);
  conversationCache = result[CONVERSATION_STORAGE_KEY] || {};
  return conversationCache;
}

async function setConversationForIssue(issueNumber, conversationUrl) {
  if (!issueNumber || !conversationUrl) return;

  const conversations = { ...(await getConversationCache()) };
  if (conversations[issueNumber] === conversationUrl) return;

  conversations[issueNumber] = conversationUrl;
  conversationCache = conversations;
  await chrome.storage.local.set({ [CONVERSATION_STORAGE_KEY]: conversations });
}

async function clearConversationForIssue(issueNumber) {
  if (!issueNumber) return;

  const conversations = { ...(await getConversationCache()) };
  if (!(issueNumber in conversations)) return;

  delete conversations[issueNumber];
  conversationCache = conversations;
  await chrome.storage.local.set({ [CONVERSATION_STORAGE_KEY]: conversations });
}

async function getPylonUrlCache() {
  if (pylonUrlCache) return pylonUrlCache;

  const result = await chrome.storage.local.get(PYLON_URL_STORAGE_KEY);
  pylonUrlCache = result[PYLON_URL_STORAGE_KEY] || {};
  return pylonUrlCache;
}

async function setPylonUrlForIssue(issueNumber, pylonUrl) {
  if (!issueNumber || !pylonUrl) return;

  const urls = { ...(await getPylonUrlCache()) };
  if (urls[issueNumber] === pylonUrl) return;

  urls[issueNumber] = pylonUrl;
  pylonUrlCache = urls;
  await chrome.storage.local.set({ [PYLON_URL_STORAGE_KEY]: urls });
}

async function findIssueForGitpodUrl(gitpodUrl) {
  if (!isGitpodDetailsUrl(gitpodUrl)) return null;

  const conversations = await getConversationCache();
  const normalizedTarget = normalizeUrl(gitpodUrl);

  for (const [issueNumber, savedUrl] of Object.entries(conversations)) {
    if (normalizeUrl(savedUrl) === normalizedTarget) {
      return issueNumber;
    }
  }

  return null;
}

function setPylonContextForTab(tabId, context) {
  if (!tabId || !context) return;

  pylonContexts.set(tabId, {
    tabId,
    url: context.url,
    issueNumber: context.issueNumber,
    source: context.source || "content",
    updatedAt: Date.now(),
  });
  panelRuntime.lastPylonContextUpdateAt = Date.now();

  if (context.issueNumber && context.url) {
    void setPylonUrlForIssue(context.issueNumber, context.url);
  }
}

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab || null;
}

function isExtensionDebugUrl(urlString) {
  return Boolean(
    urlString &&
      (urlString.startsWith(EXTENSION_ORIGIN) || urlString.startsWith("chrome://")),
  );
}

async function getPanelSourceTab() {
  const activeTab = await getActiveTab();
  if (activeTab?.id && !isExtensionDebugUrl(activeTab.url || "")) {
    lastNonExtensionTabId = activeTab.id;
    return activeTab;
  }

  if (lastNonExtensionTabId) {
    try {
      return await chrome.tabs.get(lastNonExtensionTabId);
    } catch {
      lastNonExtensionTabId = null;
    }
  }

  if (!allowExtensionDebugFallback) {
    return activeTab;
  }

  const windowTabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const fallbackTab = windowTabs
    .filter((tab) => tab.id && !isExtensionDebugUrl(tab.url || ""))
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];

  if (fallbackTab?.id) {
    lastNonExtensionTabId = fallbackTab.id;
    return fallbackTab;
  }

  return activeTab;
}

async function enableSidePanelForTab(tabId) {
  if (!tabId) return;

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true,
    });
  } catch {
    // Ignore tabs that disappear during navigation.
  }
}

async function refreshTabContext(tabId, fallbackUrl) {
  if (!tabId) return null;

  let context = fallbackUrl ? buildPylonContext(fallbackUrl, "tab-url") : null;
  if (context) {
    setPylonContextForTab(tabId, context);
  } else if (fallbackUrl && !isPylonAppUrl(fallbackUrl)) {
    pylonContexts.delete(tabId);
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "REQUEST_PYLON_CONTEXT",
    });
    if (response?.type === "PYLON_CONTEXT" && response.context) {
      context = {
        ...response.context,
        source: "content-script",
      };
      setPylonContextForTab(tabId, context);
      return pylonContexts.get(tabId);
    }
  } catch {
    // The tab may not have the content script injected.
  }

  return pylonContexts.get(tabId) || null;
}

async function getActivePylonContext() {
  const activeTab = await getPanelSourceTab();
  if (!activeTab?.id) return null;

  const refreshedContext = await refreshTabContext(activeTab.id, activeTab.url);
  return refreshedContext || null;
}

async function buildSnapshot() {
  const activeTab = await getPanelSourceTab();
  const activeContext = await getActivePylonContext();
  const conversations = await getConversationCache();
  const activeIssueNumber = activeContext?.issueNumber || null;
  const activeTabUrl = activeTab?.url ?? null;

  let reverseIssueNumber = null;
  let reversePylonUrl = null;
  if (!isPylonAppUrl(activeTabUrl || "") && isGitpodDetailsUrl(activeTabUrl || "")) {
    reverseIssueNumber = await findIssueForGitpodUrl(activeTabUrl);
    if (reverseIssueNumber) {
      const pylonUrls = await getPylonUrlCache();
      reversePylonUrl = pylonUrls[reverseIssueNumber] || null;
    }
  }

  return {
    repoUrl: DEFAULT_REPO_URL,
    activeTabId: activeTab?.id ?? null,
    activeTabUrl,
    activeTabIsPylon: isPylonAppUrl(activeTabUrl || ""),
    activePylonUrl: activeContext?.url ?? null,
    activeIssueNumber,
    savedConversationUrl: activeIssueNumber ? conversations[activeIssueNumber] || null : null,
    reverseIssueNumber,
    reversePylonUrl,
    currentIframeUrl: panelRuntime.currentIframeUrl,
    expectedFrameUrl: panelRuntime.expectedFrameUrl,
    pendingConversationCapture: getActivePendingConversationCapture(),
    lastObservedGitpodUrl: panelRuntime.lastObservedGitpodUrl,
    lastObservedGitpodSource: panelRuntime.lastObservedGitpodSource,
    lastCreateUrl: panelRuntime.lastCreateUrl,
    lastStaleEvent: panelRuntime.lastStaleEvent,
    panelVisualState: panelRuntime.visualState,
    lastPylonContextUpdateAt: panelRuntime.lastPylonContextUpdateAt,
    lastGitpodLocationUpdateAt: panelRuntime.lastGitpodLocationUpdateAt,
    gitpodDocumentId: panelRuntime.gitpodDocumentId,
  };
}

async function postSnapshot(port) {
  try {
    port.postMessage({
      type: "SNAPSHOT",
      snapshot: await buildSnapshot(),
    });
  } catch {
    panelPorts.delete(port);
  }
}

async function broadcastSnapshot() {
  const ports = Array.from(panelPorts);
  await Promise.all(ports.map((port) => postSnapshot(port)));
}

async function handlePylonContextMessage(message, sender) {
  if (!sender.tab?.id || !message.context) return;

  if (!message.context.url || !isPylonAppUrl(message.context.url)) {
    pylonContexts.delete(sender.tab.id);
  } else {
    setPylonContextForTab(sender.tab.id, {
      url: message.context.url,
      issueNumber: message.context.issueNumber,
      source: "content-script",
    });
    await enableSidePanelForTab(sender.tab.id);
  }

  await broadcastSnapshot();
}

async function handleGitpodLocationMessage(message, sender) {
  if (!message.url) return;

  const existingSession = sender.documentId ? gitpodDocuments.get(sender.documentId) : null;
  const pendingCapture = getActivePendingConversationCapture();
  const normalizedMessageUrl = normalizeUrl(message.url);
  const normalizedReferrer = normalizeUrl(message.referrer || "");
  const normalizedExpectedFrameUrl = normalizeUrl(panelRuntime.expectedFrameUrl);
  const matchesExpectedFrameUrl =
    Boolean(normalizedExpectedFrameUrl) &&
    (normalizedMessageUrl === normalizedExpectedFrameUrl ||
      normalizedReferrer === normalizedExpectedFrameUrl);
  const pendingCaptureMatches =
    Boolean(pendingCapture) &&
    shouldPersistConversationUrl(message.url, pendingCapture.issueNumber);
  const isPanelFrame = Boolean(
    message.isPanelFrame || existingSession?.isPanelFrame || matchesExpectedFrameUrl || pendingCaptureMatches,
  );
  const issueNumber =
    existingSession?.issueNumber ||
    (matchesExpectedFrameUrl && panelRuntime.issueNumber) ||
    pendingCapture?.issueNumber ||
    panelRuntime.issueNumber ||
    null;
  const session = {
    documentId: sender.documentId || null,
    url: message.url,
    updatedAt: Date.now(),
    isPanelFrame,
    referrer: message.referrer || "",
    issueNumber,
  };

  if (session.documentId) {
    gitpodDocuments.set(session.documentId, session);
  }

  noteGitpodObservation(message.url, isPanelFrame ? "panel-frame" : "gitpod-message");

  if (!isPanelFrame) return;

  panelRuntime.currentIframeUrl = message.url;
  panelRuntime.gitpodDocumentId = sender.documentId || panelRuntime.gitpodDocumentId;

  if (issueNumber && shouldPersistConversationUrl(message.url, issueNumber)) {
    await setConversationForIssue(issueNumber, message.url);
    panelRuntime.pendingConversationCapture = null;
    panelRuntime.expectedFrameUrl = message.url;
  }

  await broadcastSnapshot();
}

async function handlePortMessage(port, message) {
  switch (message?.type) {
    case "PANEL_OPTIONS":
      allowExtensionDebugFallback = Boolean(message.allowExtensionDebugFallback);
      await broadcastSnapshot();
      break;
    case "REQUEST_SNAPSHOT":
      await postSnapshot(port);
      break;
    case "PANEL_VISUAL_STATE":
      panelRuntime.issueNumber = message.issueNumber || null;
      panelRuntime.visualState = message.visualState || panelRuntime.visualState;
      panelRuntime.currentIframeUrl = message.currentIframeUrl || null;
      await broadcastSnapshot();
      break;
    case "PANEL_FRAME_TARGET":
      panelRuntime.issueNumber = message.issueNumber || null;
      panelRuntime.visualState = message.visualState || panelRuntime.visualState;
      panelRuntime.expectedFrameUrl = message.url || null;
      panelRuntime.currentIframeUrl = message.url || null;
      if (message.reason === "create") {
        panelRuntime.lastCreateUrl = message.url || null;
        beginPendingConversationCapture(message.issueNumber || null, message.url || null);
      } else {
        panelRuntime.pendingConversationCapture = null;
      }
      await broadcastSnapshot();
      break;
    default:
      break;
  }
}

async function handleStaleEnvironmentRequest(details) {
  if (details.statusCode !== 404) return;
  if (details.frameType && details.frameType !== "sub_frame") return;

  const issueNumber = panelRuntime.issueNumber;
  if (!issueNumber) return;

  const expectedUrl = panelRuntime.expectedFrameUrl;
  if (!expectedUrl || !expectedUrl.startsWith(`${GITPOD_ORIGIN}/details/`)) return;

  const conversations = await getConversationCache();
  const savedUrl = conversations[issueNumber];
  if (!savedUrl || normalizeUrl(savedUrl) !== normalizeUrl(expectedUrl)) return;

  await clearConversationForIssue(issueNumber);

  panelRuntime.expectedFrameUrl = null;
  panelRuntime.pendingConversationCapture = null;
  panelRuntime.lastStaleEvent = {
    issueNumber,
    url: details.url,
    statusCode: details.statusCode,
    documentId: details.documentId || null,
    timestamp: Date.now(),
  };

  await broadcastSnapshot();
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    lastNonExtensionTabId = tab.id;
    await chrome.sidePanel.open({ tabId: tab.id });
    await refreshTabContext(tab.id, tab.url);
  }

  await broadcastSnapshot();
});

async function broadcastTriggerVisibility(visible) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: "https://app.usepylon.com/*" });
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "TRIGGER_VISIBILITY",
          visible,
        });
      } catch {
        // Tab may not have the content script injected yet.
      }
    }),
  );
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;

  const wasEmpty = panelPorts.size === 0;
  panelPorts.add(port);
  if (wasEmpty) {
    void broadcastTriggerVisibility(false);
  }

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
    if (panelPorts.size === 0) {
      void broadcastTriggerVisibility(true);
    }
  });
  port.onMessage.addListener((message) => {
    void handlePortMessage(port, message);
  });

  void broadcastSnapshot();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = (async () => {
    switch (message?.type || message?.action) {
      case "openSidePanel":
        if (sender.tab?.id) {
          lastNonExtensionTabId = sender.tab.id;
          await chrome.sidePanel.open({ tabId: sender.tab.id });
          await refreshTabContext(sender.tab.id, sender.tab.url);
          await broadcastSnapshot();
        }
        return { ok: true };
      case "PYLON_CONTEXT":
        await handlePylonContextMessage(message, sender);
        return { ok: true };
      case "GITPOD_LOCATION":
        await handleGitpodLocationMessage(message, sender);
        return { ok: true };
      case "REQUEST_TRIGGER_VISIBILITY":
        return { type: "TRIGGER_VISIBILITY", visible: panelPorts.size === 0 };
      default:
        return { ok: false };
    }
  })();

  handler.then(sendResponse).catch((error) => {
    console.error("background message error", error);
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isExtensionDebugUrl(tab.url || "")) {
    lastNonExtensionTabId = tabId;
  }

  if ((changeInfo.url || changeInfo.status === "complete") && tab.url?.startsWith(GITPOD_ORIGIN)) {
    void maybePersistPendingConversationUrl(tab.url, "gitpod-tab").then((didPersist) => {
      if (didPersist) {
        void broadcastSnapshot();
      }
    });
  }

  if (changeInfo.url || changeInfo.status === "complete") {
    void refreshTabContext(tabId, changeInfo.url || tab.url).then(() => broadcastSnapshot());
  }

  if (tab.url && isPylonAppUrl(tab.url)) {
    void enableSidePanelForTab(tabId);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs
    .get(activeInfo.tabId)
    .then((tab) => {
      if (!isExtensionDebugUrl(tab.url || "")) {
        lastNonExtensionTabId = activeInfo.tabId;
      }
    })
    .catch(() => {});

  void refreshTabContext(activeInfo.tabId).then(() => broadcastSnapshot());
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pylonContexts.delete(tabId);
  void broadcastSnapshot();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  let shouldBroadcast = false;
  if (changes[CONVERSATION_STORAGE_KEY]) {
    conversationCache = changes[CONVERSATION_STORAGE_KEY].newValue || {};
    shouldBroadcast = true;
  }
  if (changes[PYLON_URL_STORAGE_KEY]) {
    pylonUrlCache = changes[PYLON_URL_STORAGE_KEY].newValue || {};
    shouldBroadcast = true;
  }

  if (shouldBroadcast) void broadcastSnapshot();
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    void handleStaleEnvironmentRequest(details);
  },
  {
    urls: [`${GITPOD_ORIGIN}/api/gitpod.v1.EnvironmentService/GetEnvironment`],
    types: ["xmlhttprequest"],
  },
);
