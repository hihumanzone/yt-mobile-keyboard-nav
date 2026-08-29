# YouTube Mobile Enhanced

A Manifest V3 Chrome extension that brings YouTube’s mobile experience to desktop, with desktop-friendly playback controls, background playback support, and feed/watch-page layout fixes.

## Features

- **Mobile mode on desktop** using declarativeNetRequest UA override.
- **Background playback** by spoofing visibility state in the page context.
- **Keyboard controls** for playback, seek, volume, mute, and fullscreen.
- **Enhanced volume UI** with HUD, slider panel, and boost up to 300%.
- **Watch page desktop optimization** with optional single related-videos sidebar.
- **Feed bootstrap fixes** to force lazy-loaded shelves to materialize reliably.
- **Post image enhancements** (hi-res upgrades, fade-in, carousel edge behavior).
- **Hover video preview** with optional preview sound and inline mute toggle.

## Tech Stack

- **Platform:** Chrome Extension Manifest V3
- **Languages:** Vanilla JavaScript (ES6+), CSS, HTML
- **Runtime APIs:** `chrome.storage`, `chrome.declarativeNetRequest`, service worker
- **Architecture:** Flat-file, no build step, no bundler, no external dependencies

## Project Structure

```text
.
├── manifest.json
├── rules.json
├── popup/
│   ├── popup.html
│   └── popup.js
├── src/
│   ├── background/background.js
│   ├── content/
│   │   ├── content-core.js
│   │   ├── content-player.js
│   │   ├── content-mobile.js
│   │   ├── content-feed.js
│   │   ├── content-preview.js
│   │   └── content.js
│   └── inject/inject.js
└── styles/
    ├── content-core.css
    ├── content-player.css
    ├── content-mobile.css
    └── content-preview.css
```

## How It Works

- **Isolated-world content scripts** (`src/content/*`) share `globalThis.YTME` for config, state, UI modules, and bootstrap wiring.
- **MAIN-world injector** (`src/inject/inject.js`) patches page-level APIs (visibility, History API, `IntersectionObserver`) that isolated scripts cannot reliably affect.
- **Background service worker** (`src/background/background.js`) toggles the DNR ruleset and reloads YouTube tabs when mobile mode changes.
- **Popup UI** (`popup/*`) manages feature flags in `chrome.storage.local`, including dependency rules between toggles.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the project folder (the directory containing `manifest.json`).
6. Open YouTube and use the extension popup to toggle features.

## Usage

### Feature toggles

Open the extension popup and enable/disable:

- Mobile Mode
- Background Play
- Keyboard Controls
- Video Preview
- Preview Sound
- Single Sidebar

Dependency behavior:

- Turning **Mobile Mode off** forces **Background Play**, **Keyboard Controls**, and **Single Sidebar** off.
- Turning **Video Preview off** forces **Preview Sound** off.

### Keyboard shortcuts

- `Space`: Play / Pause
- `←` / `→`: Seek -10s / +10s
- `↑` / `↓`: Volume +10% / -10%
- `Shift` + `↑` / `↓`: Fine volume +2% / -2%
- `M`: Mute / Unmute
- `F`: Fullscreen toggle

Shortcuts are ignored while typing in inputs/textboxes.

### Usage examples

- **Desktop mobile feed:** keep **Mobile Mode** on and open `https://www.youtube.com/` to get mobile feed rendering with extension layout fixes.
- **Background listening:** keep **Mobile Mode** + **Background Play** on, start a video, switch tabs, and continue audio playback.
- **Preview browsing:** keep **Video Preview** on, hover a thumbnail to autoplay preview, then press `M` to mute/unmute the preview audio.
- **Watch-page layout mode switch:** toggle **Single Sidebar** on `/watch` to switch between fixed single-column suggestions and YouTube’s native multi-column behavior.

## Configuration

### Storage keys (`chrome.storage.local`)

- `ytMobileEnabled` (default: `true`)
- `ytBackgroundEnabled` (default: `true`)
- `ytKeyboardEnabled` (default: `true`)
- `ytPreviewEnabled` (default: `true`)
- `ytPreviewSoundEnabled` (default: `false`)
- `ytSingleSidebarEnabled` (default: `true`)

### Manifest and network rules

- `manifest.json`
  - MV3 content scripts (isolated + MAIN world)
  - service worker registration
  - DNR ruleset registration (`ruleset_1`)
- `rules.json`
  - Rule `id: 1`: sets mobile User-Agent
  - Rule `id: 2`: removes `app` query param from YouTube main-frame URLs

### Tunable runtime constants

Most behavior tuning lives in `src/content/content-core.js` under `CONFIG`, including:

- Volume curves and max boost
- HUD/panel timing
- Mobile layout refresh timing
- Feed bootstrap and safety retry timing
- Post image enhancement thresholds
- Preview timing and iframe settings

## Manual Testing

There are no automated tests in this repository. Validate manually:

1. Load extension unpacked in Chrome.
2. Open YouTube home, watch page, and channel pages.
3. Verify:
   - Mobile mode layout classes and rendering
   - Keyboard shortcuts and volume HUD/panel
   - Background playback with hidden tab
   - Hover previews with and without preview sound
   - Feed shelves load without empty gaps
4. In DevTools console, confirm:
   - `document.documentElement.dataset.ytExtIoPatched === "1"`

## Notes

- No build or install command is required.
- Reload the extension in `chrome://extensions` after source edits.
- Excludes YouTube Studio and YouTube Music from mobile-mode behavior.
