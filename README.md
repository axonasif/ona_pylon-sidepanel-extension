# Ona Side Panel for Pylon

A Chrome extension that embeds [app.gitpod.io](https://app.gitpod.io) in Chrome's Side Panel when browsing Pylon issues.

## Features

- **Side Panel** — Opens Ona (Gitpod) in Chrome's native side panel
- **Floating trigger** — Orange button on `app.usepylon.com/issues` pages to open the panel
- **Toolbar icon** — Click the extension icon to open the side panel on any tab
- **Header stripping** — Removes `X-Frame-Options` and `Content-Security-Policy` headers so the iframe loads

## Install locally

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` directory

## Develop & test with VNC

This repo includes a VNC-based devcontainer with Chrome pre-installed. Open it in Ona to get a full desktop environment for testing:

[![Open in Ona](https://gitpod.io/button/open-in-gitpod.svg)](https://app.gitpod.io/#https://github.com/ona-samples/ona_pylon-sidepanel-extension)

Once the environment starts:
1. Open port **5901** from the Environment tab to access the VNC desktop
2. Run the **"Launch Chrome with extension loaded"** task from automations to start Chrome with the extension pre-loaded
3. Navigate to `https://app.usepylon.com/issues` to test

## Extension structure

```
extension/
├── manifest.json       # Manifest V3 config
├── background.js       # Service worker: side panel activation, message handling
├── sidepanel.html      # Side panel UI with iframe
├── sidepanel.js        # Side panel logic
├── content.js          # Injects floating trigger button on Pylon pages
├── content.css         # Floating button styles
├── rules.json          # declarativeNetRequest rules to strip frame-blocking headers
└── icons/              # Extension icons (16, 48, 128px)
```
