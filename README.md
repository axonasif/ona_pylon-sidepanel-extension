# Ona Side Panel for Pylon

Chrome extension that opens Ona (`app.gitpod.io`) inside Chrome's side panel while you work in Pylon, with issue-aware state and one saved Ona conversation URL per Pylon issue.

This README is the current source of truth for the project. It is written to help humans and agents pick up the codebase quickly without needing to rediscover the browser-specific behavior.

## Current product behavior

### Supported Pylon pages

The extension currently targets these Pylon URL shapes:

- `https://app.usepylon.com/issues*`
- `https://app.usepylon.com/support/issues/*`

The actual issue context comes from the `issueNumber` query param, not just the pathname.

Examples:

- Issue view: `.../support/issues/views/...?...issueNumber=28049&view=fs`
- Dashboard-like view: `.../support/issues/views/...` with no `issueNumber`

Behavior:

- If `issueNumber` exists, the extension treats the active Pylon tab as a specific issue.
- If `issueNumber` is absent, the side panel shows an empty state telling the user to pick an issue.

### Ona side panel states

The panel is a small state machine:

- `no-issue`: no specific Pylon issue is selected
- `resolving`: waiting for active tab / storage state
- `create`: no saved Ona conversation for this issue yet
- `loading`: loading either a saved Ona URL or a freshly created Ona URL
- `stale-env`: the saved Ona environment appears to have been deleted

### V1 conversation model

V1 is intentionally single-repo only.

- Hard-coded repo: `https://github.com/gitpod-io/gitpod-next`
- Storage key shape: `issueNumber -> conversationUrl`
- There is exactly one saved Ona URL per Pylon issue in `chrome.storage.local`
- Multi-repo support is intentionally out of scope for now

### New Ona conversation URL

When there is no saved conversation for an issue, the panel offers to create one with:

```text
https://app.gitpod.io/ai?p=<encoded "work on pylon {issueNumber}">#https://github.com/gitpod-io/gitpod-next
```

The code deliberately does not persist this initial bootstrap URL as the saved conversation. It only persists later Gitpod/Ona URLs that look like a real conversation or environment URL.

The create UI currently has two launch variants:

- primary action: `Create Ona conversation`
  - uses the default prompt `work on pylon {issueNumber}`
- secondary edit action:
  - uses a more editable scaffold:

```text
Context: pylon {issueNumber}

Ask:
```

Important Gitpod org note:

- if the extension already knows the Gitpod principal for `ona.com`, it currently appends a temporary `ona_target_principal=<principal>` query param before loading Gitpod
- `gitpod-content.js` reads that value at `document_start`, copies it into `localStorage["principal"]` and `sessionStorage["principal"]`, then immediately removes the query param with `history.replaceState(...)`
- this is an internal extension bootstrap hint, not a real Gitpod app parameter
- this exists to avoid an extra reload when steering the side panel into the desired Gitpod organization
- if we later want a cleaner implementation, this bootstrap can be replaced with an extension-managed storage/session handoff instead of a URL param
- when comparing Gitpod URLs for pending-create capture and restore, the extension must ignore this internal query param; treating it as part of the canonical URL breaks save/restore matching

### Saved conversation restore

If the extension already has a saved Ona URL for the current issue, it automatically loads that URL in the side panel iframe.

### Deleted environment detection

The background service worker watches:

- `POST https://app.gitpod.io/api/gitpod.v1.EnvironmentService/GetEnvironment`

If the request returns `404` for the side panel's Gitpod session, the extension treats the saved URL as stale:

- clears the saved mapping for that issue
- records the stale event in runtime state
- moves the side panel into the `stale-env` fallback state

### Side panel controls

The toolbar at the top of the panel is part of the extension UI, not Chrome's side panel API.

- `↻` reloads the iframe
- `↗` opens the current Ona target in a normal tab
- `⋯` toggles the debug overlay
- trash/delete control is a two-step action:
  - first click arms delete for 5 seconds
  - second click sends the delete request to Gitpod
  - confirmation/error notices are shown just above the bottom toolbar so the feedback feels attached to the control

## Architecture

### `extension/manifest.json`

Important manifest details:

- MV3 extension
- `sidePanel`, `storage`, and `webRequest` permissions
- host permissions for both Pylon and Gitpod
- `content.js` on Pylon pages
- `gitpod-content.js` on `https://app.gitpod.io/*`
- `declarativeNetRequest` rules in `rules.json` to strip iframe-blocking headers

### `extension/background.js`

The service worker is the main coordinator.

Responsibilities:

- enables the side panel on supported Pylon tabs
- tracks active Pylon issue context per tab
- caches one saved Ona conversation URL per issue
- receives live updates from the Pylon and Gitpod content scripts
- tracks panel runtime/debug state
- detects stale environments via `webRequest`
- broadcasts snapshots to the side panel over a long-lived port

Important in-memory/runtime structures:

- `pylonContexts`: per-tab Pylon issue context
- `gitpodDocuments`: tracked Gitpod document sessions
- `panelRuntime`: current visual/debug state of the panel
- `conversationCache`: storage-backed issue-to-URL map

### `extension/content.js`

Runs on Pylon pages.

Responsibilities:

- injects the floating orange button
- reports current `{ url, issueNumber }` to the background worker
- listens for SPA navigation by patching `history.pushState`, `history.replaceState`, and `popstate`
- answers `REQUEST_PYLON_CONTEXT` from the background

Important note:

- The floating button still relies on a direct user gesture. `chrome.sidePanel.open()` must happen without doing async work first, otherwise Chrome rejects it.

### `extension/gitpod-content.js`

Runs on Gitpod pages, including the side panel iframe.

Responsibilities:

- reports the current Gitpod URL to the background worker
- reports SPA navigation through patched `history` plus `hashchange`
- marks whether the page appears to be running inside the extension panel by checking `document.referrer`
- bootstraps the desired Gitpod principal from the temporary `ona_target_principal` query param before the app hydrates
- reports Gitpod account memberships back to the background worker so the extension can cache org-name -> principal mappings, especially for `ona.com`
- uses the current iframe principal for destructive Gitpod requests such as `DeleteEnvironment`

Important notes:

- Gitpod request auth is principal-sensitive; requests like `DeleteEnvironment` should use the current principal at request time, not only a cached background copy
- Gitpod expects the principal header in the form `user/<id>` for user principals

### `extension/sidepanel.html` and `extension/sidepanel.js`

These files define the actual extension panel UI.

Responsibilities:

- connect to the background via `chrome.runtime.connect({ name: "sidepanel" })`
- render the state machine
- drive the iframe target URL
- show the debug panel
- report current panel visual state back to the background

The debug panel is intentionally read-only and shows:

- active Pylon URL
- active issue number
- saved conversation URL
- current iframe URL
- expected frame URL
- last create URL
- last stale event
- last Pylon update timestamp
- last Gitpod update timestamp

The debug panel is especially useful for confirming:

- whether a create flow has an active `pendingConversationCapture`
- whether the iframe is actually reporting Gitpod location updates
- whether the saved URL is the expected `/details/...` URL

## Development workflow

### Load the extension locally

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select the `extension/` directory

When code changes:

1. Click Reload for the unpacked extension in `chrome://extensions/`
2. Reload the active Pylon tab
3. Reopen or retrigger the side panel if needed

### Manual test checklist

#### Basic issue flow

1. Open a real Pylon issue URL with `issueNumber=...`
2. Click the floating orange button
3. Confirm the side panel opens
4. Confirm the panel shows either:
   - `Create a new Ona conversation`, or
   - a previously saved Ona conversation loading automatically

#### Dashboard / no-issue flow

1. Open a Pylon page with no `issueNumber` in the URL
2. Open the side panel
3. Confirm the panel shows the `Open a Pylon issue first` empty state

#### Saved conversation flow

1. Open a Pylon issue
2. Create or navigate to a real Ona conversation/environment in the side panel
3. Close and reopen the panel, or navigate away and back
4. Confirm the saved Ona URL restores for the same issue

Important implementation note:

- restore/save matching should compare Gitpod URLs after stripping internal extension-only bootstrap params like `ona_target_principal`

#### Stale environment flow

This is harder to automate locally.

Expected behavior when Gitpod returns `404` for `GetEnvironment`:

- saved URL is cleared
- panel shows stale-environment messaging
- user is prompted to create a fresh Ona conversation

#### Delete environment flow

1. Open a saved Ona environment in the side panel
2. Click the delete control once and confirm the panel shows the armed state / confirmation notice
3. Click it again within 5 seconds
4. Confirm the extension sends `DeleteEnvironment`
5. Confirm the panel clears the saved mapping and falls back appropriately

If delete fails with `401`:

- the most likely cause is principal/auth mismatch
- compare the successful live Gitpod requests in DevTools with the principal used by the extension
- the delete flow should use the iframe's current principal and normalize it to `user/<id>` when needed

## Project-specific development practices

This section captures the practical workflow knowledge that proved most reliable while building and debugging this extension. It is intentionally opinionated and based on what actually worked in this codebase.

### The fastest debugging order

When something breaks, the most effective order is:

1. look at the in-panel debug JSON first
2. check live network activity on Pylon and/or Gitpod
3. only then inspect code and internal state assumptions

Why this order works well here:

- many failures in this project are integration failures, not pure logic bugs
- the panel debug output already reflects the background worker's actual state model
- the network layer tells you whether the page/app is healthy even when the extension is not
- DOM-only inspection is often misleading because both Pylon and Gitpod are SPAs with lots of intermediate UI states

### Signals that are trustworthy

These signals have been consistently reliable:

- Pylon issue identity:
  - `issueNumber` from the Pylon URL query string
- Gitpod saved-conversation identity:
  - canonical `/details/<environment-id>` URLs
- Pylon tag updates:
  - `updateIssueFields`
- Current applied Pylon issue tags:
  - `getSidebarIssue`
- Deleted environment detection:
  - `GetEnvironment` returning `404`
- Current Gitpod auth context:
  - the iframe page's current principal at request time

These signals are useful but should be treated carefully:

- Pylon DOM scraping:
  - fine for lightweight reads, but weaker than GraphQL/network-backed reads
- exact raw Gitpod URL equality:
  - internal extension-only params can make equivalent states look different
- cached principal values in background state:
  - useful for UI/debug, but not sufficient for sensitive requests like delete
- extension-tab inspection:
  - can help with UI work, but is not the same runtime container as the real side panel

### Hard rules for this codebase

These are not just preferences; they prevent real regressions:

- Treat the Pylon `issueNumber` query param as the source of truth for issue selection.
- Treat Gitpod `/details/...` URLs as the canonical save/restore target.
- Never persist the initial `/ai?...` bootstrap URL as the saved conversation.
- Strip internal extension-only Gitpod query params before comparing create/restore URLs.
  - today the important one is `ona_target_principal`
- For destructive Gitpod actions, use the iframe's current principal at request time.
- Normalize user principals to the header format Gitpod expects:
  - `user/<id>`
- Do not make `chrome.sidePanel.open()` wait on async work.
  - Chrome rejects it unless it stays in the original user gesture path

### Message-path mental model

This extension is mostly coordination code. A lot of bugs become obvious once you identify which message path is supposed to own the behavior.

Main paths:

- Pylon issue context:
  - `content.js -> background.js -> sidepanel.js`
- Gitpod iframe URL/account context:
  - `gitpod-content.js -> background.js -> sidepanel.js`
- Panel-initiated Gitpod actions:
  - `sidepanel.js -> iframe postMessage -> gitpod-content.js`
- Storage-backed restore:
  - `background.js -> sidepanel.js`

Implication:

- if the panel UI is wrong, first ask whether the background snapshot is wrong
- if the background snapshot is wrong, first ask whether the content script message arrived
- if the message arrived but the state is still wrong, then inspect normalization/correlation logic

### Reload discipline

This project is unusually sensitive to stale extension state. Many apparent bugs are just old content scripts or an old side panel session.

When you change code, the safe manual reset sequence is:

1. reload the unpacked extension in `chrome://extensions`
2. reload the active Pylon tab
3. reload or reopen the active Gitpod tab if that code path changed
4. close and reopen the side panel
5. only then trust the result

If you skip this sequence:

- old content scripts may still be running on existing tabs
- the panel may still be connected to an older service worker instance
- Gitpod iframe behavior may reflect a prior build even when the repo has newer code

### Side panel vs normal-tab testing

Both are useful, but they answer different questions.

Use a normal Gitpod tab when you want to inspect:

- network requests
- auth/principal behavior
- whether Gitpod itself is healthy
- whether a URL is canonical or save-worthy

Use the real side panel when you want to inspect:

- create/save/restore flow
- iframe-specific messaging
- panel controls
- pending capture behavior
- delete behavior

Important caveats:

- `chrome-extension://.../sidepanel.html` in a normal tab is not the real side panel container
- a regular `app.gitpod.io` tab is not a perfect proxy for the iframe lifecycle
- DevTools/MCP may expose normal tabs even when it does not expose the side panel itself

### Network-first debugging patterns

This repo has repeatedly benefited from debugging against real requests rather than inferred state.

Pylon:

- if tags seem wrong:
  - inspect `getSidebarIssue` or `updateIssueFields`
- if issue identity seems wrong:
  - check the URL before checking DOM text

Gitpod:

- if restore/save is broken:
  - inspect whether the app really reaches a `/details/...` URL
- if stale detection is broken:
  - inspect `GetEnvironment`
- if delete is broken:
  - inspect whether `DeleteEnvironment` is sent at all
  - if sent, compare its auth headers to successful requests from the same page

### How to interpret common failures

If the panel shows `create` when you expected restore:

- check whether `savedConversationUrl` is null in Debug
- if null, the issue is usually persistence/capture, not restore lookup
- confirm whether the iframe actually reported a `/details/...` URL
- confirm URL matching is not being broken by internal query params

If Debug shows no Gitpod updates at all:

- suspect `gitpod-content.js` injection or startup failure first
- do not start by changing persistence logic

If delete reports `401`:

- suspect principal mismatch first
- compare with successful `GetEnvironment` or other live Gitpod requests from the same page

If a UI action appears inert:

- check whether the UI is actually a staged action
  - delete is a two-step confirm flow
- add or verify visible feedback before assuming the backend path is broken

### Recommended regression checklist before shipping changes

After touching the extension, the most valuable quick regression pass is:

1. open a Pylon issue and verify the panel opens
2. verify issue detection on a real issue URL
3. create a new Ona conversation
4. confirm the conversation is saved after Gitpod reaches `/details/...`
5. navigate away and back to the same issue and confirm auto-restore
6. navigate to a non-issue Pylon page and confirm `no-issue`
7. navigate to a non-Pylon page and confirm `not-pylon`
8. verify `ona_ai` tag sync still runs when creating
9. verify the delete control still behaves as expected
10. if you changed principal/org logic, verify Gitpod is still using `ona.com`

### MCP and inspection limitations

This project has some recurring tooling constraints that are worth remembering:

- MCP usually sees normal web tabs more reliably than `chrome-extension://...` targets
- the side panel's own document may exist in Chrome but still not be attachable through MCP
- manual DevTools on the side panel can be useful even when the agent cannot attach to it
- because of that, the in-panel debug view is not optional nicety; it is a core development tool for this project

### What to avoid rediscovering

These were real sources of wasted time and should be assumed up front:

- trying to infer issue identity from Pylon DOM when the URL already tells the truth
- trusting a cached principal for sensitive Gitpod actions
- assuming a single click on the delete button should immediately send a backend request
- comparing raw Gitpod URLs without stripping extension-only bootstrap params
- assuming a normal extension tab is equivalent to the actual side panel runtime

## Debugging and inspection

### Recommended debugging path

The best debugging surface is the debug panel inside the extension itself.

Why:

- DevTools/MCP visibility into `chrome-extension://...` pages is inconsistent
- the real side panel container is harder to inspect than a normal tab
- the in-panel debug output shows the actual state used by the extension

### Opening the side panel document in a tab

The side panel page itself is:

```text
chrome-extension://<extension-id>/sidepanel.html
```

For this unpacked build it is usually:

```text
chrome-extension://kkhnkokcnedmkohnmfbgpbfpeicddbip/sidepanel.html
```

This can be useful for UI inspection, but there is an important caveat:

- a normal extension tab is not the same thing as the real side panel container

### Dev-only fallback for extension-tab inspection

There is a dev-only inspection mode:

```text
chrome-extension://kkhnkokcnedmkohnmfbgpbfpeicddbip/sidepanel.html?dev=1
```

What it does:

- allows the background worker to fall back to the most recently used non-extension tab in the current window when the active tab is an extension page or `chrome://...`

Why it exists:

- it helps when manually inspecting `sidepanel.html` in a normal tab during development

Why it is disabled by default:

- production and normal manual testing should use the simpler in-memory active-tab path
- the fallback is only for debugging and is not intended as normal runtime behavior

Current recommendation:

- do not rely on `?dev=1` for normal use
- prefer testing the real side panel and using the in-panel Debug section

### Chrome extension errors

If the extension starts behaving strangely:

1. Open `chrome://extensions/`
2. Find the unpacked extension
3. Click `Errors`

One specific error already encountered during development:

- `sidePanel.open() may only be called in response to a user gesture`

This is why the floating button and toolbar action path must call `chrome.sidePanel.open()` immediately, before any async context refresh work.

## Known limitations and current caveats

- V1 supports only one repo, hard-coded to `gitpod-io/gitpod-next`
- saved state is one URL per issue only
- direct inspection of `chrome-extension://.../sidepanel.html` is useful but not fully representative of the real side panel container
- the `?dev=1` extension-tab fallback exists only for development and should be treated as best-effort
- the stale-environment detection path exists, but still needs more real-world manual validation against actual deleted Gitpod environments
- `extension/_metadata/` is Chrome-generated when the unpacked extension is loaded; it is not hand-authored source

## File guide

```text
extension/
├── manifest.json        # MV3 manifest, permissions, content scripts
├── background.js        # Service worker and source of truth for runtime state
├── content.js           # Pylon content script: issue context + floating trigger
├── gitpod-content.js    # Gitpod content script: iframe URL tracking
├── sidepanel.html       # Side panel UI shell
├── sidepanel.js         # Side panel state machine and rendering
├── content.css          # Floating button styling
├── rules.json           # Removes X-Frame-Options / CSP so Gitpod can iframe
├── icons/               # Extension icons
└── _metadata/           # Chrome-generated; not part of authored source
```

## Suggestions for future work

- multi-repo support:
  - likely evolve storage from `issueNumber -> conversationUrl` to `issueNumber + repoUrl -> conversationUrl`
- more robust persistence heuristics for determining when a Gitpod URL is “real enough” to save
- stronger stale-environment correlation and test coverage
- optional dedicated dev build or manifest flag if extension-tab debugging becomes a regular workflow
