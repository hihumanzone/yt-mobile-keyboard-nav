# YouTube Mobile Enhanced — Chrome Extension (MV3)

## Architecture

A flat-file Chrome extension (no build step, no bundler, no package.json). All JS/CSS is loaded directly via `manifest.json`.

**Execution worlds:**
- `src/content/content-*.js` + `src/content/content.js` — run in the **isolated world** (content scripts). They share `globalThis.YTME` and are loaded in manifest order: core config/state/utilities, player UI/keyboard/video lifecycle, mobile layout, feed/post enhancements, preview, then the `src/content/content.js` bootstrap/storage sync.
- `src/inject/inject.js` — runs in the **MAIN world** (`"world": "MAIN"` in manifest). Only this script can modify page JS prototypes. It spoofs `document.hidden`/`visibilityState` for background playback, hooks SPA navigation via History API, simulates periodic keypresses to prevent inactivity pauses, **and patches `window.IntersectionObserver` to widen `rootMargin` so YouTube's lazy `ytm-rich-grid-renderer` materialises its first batch on small laptop viewports**.
- `src/background/background.js` — service worker. Toggles the `declarativeNetRequest` ruleset (which sets a mobile User-Agent and strips `app=` query param) and reloads YouTube tabs on state change.
- `popup/popup.html`/`popup/popup.js` — extension popup UI with feature toggles.

**Communication between worlds:**
- isolated-world content scripts → `src/inject/inject.js`: `window.dispatchEvent(new CustomEvent("yt-ext-bg-toggle", ...))`
- `src/inject/inject.js` → page: patches `Document.prototype.hidden`, `visibilityState`, hooks `addEventListener` to suppress `visibilitychange`, and replaces `window.IntersectionObserver` with a shim
- `src/inject/inject.js` → isolated-world content scripts (one-way, via shared DOM): sets `document.documentElement.dataset.ytExtIoPatched = "1"` so content scripts can detect the patch is in place

## Key conventions & gotchas

- **No build system.** Edit files directly; reload the extension in `chrome://extensions` to test.
- **Two content script entries** in manifest — one isolated-world entry with ordered `src/content/content-*.js` files plus `src/content/content.js`, and one MAIN-world entry (`src/inject/inject.js`). Both run at `document_start`. `src/inject/inject.js` must be listed as `web_accessible_resources` because it's injected by Chrome into the MAIN world.
- **Feature flags** are stored in `chrome.storage.local` (not `sync`). Keys: `ytMobileEnabled`, `ytBackgroundEnabled`, `ytKeyboardEnabled`, `ytPreviewEnabled`, `ytPreviewSoundEnabled`, `ytSingleSidebarEnabled`. Defaults are in both `src/content/content-core.js` (`State` object) and `popup/popup.js` (`DEFAULTS`).
- **Background playback and single sidebar disable when mobile mode is off.** `src/content/content.js` forces `background`, `keyboard`, and `singleSidebar` to `false` when `mobile` is toggled off and writes to storage. Mirror this dependency.
- **Mobile layout CSS** targets `html.yt-mobile-mode` and `html.yt-mobile-watch-mode` classes, activated by `MobileLayout.update()`. The watch mode class (`yt-mobile-watch-mode`) is only added when both `mobile` and `singleSidebar` are enabled; setting `singleSidebar` off lets YouTube render its native multi-column suggestions layout. The watch page layout is a two-column design (video left, suggestions sidebar fixed right) that collapses below 992px viewport width.
- **Mobile-mode path coverage** is defined by `CONFIG.MOBILE_ALLOWED_PATHS` and matches the home feed (`/`, `/feed`), channel pages (`/@handle` and its sub-tabs: `/posts`, `/community`, `/videos`, `/shorts`, `/playlists`, `/channels`, `/featured`, `/about`), and `/watch`. Without this match, the `yt-mobile-mode` class is not added, so all CSS gated on that class (including post image styling, header fixes, bottom-bar layout) silently doesn't apply.
- **Volume boost >100%** uses WebAudio `GainNode` + `DynamicsCompressorNode`. The `AudioEngine` connects via `createMediaElementSource` — this is a one-time operation per `<video>` element; calling it twice on the same element throws.
- **`VideoCache`** prioritizes the `#player-container-id video` on `/watch` pages to avoid grabbing autoplay thumbnails from the home feed.
- **`rules.json`** uses `declarativeNetRequest` (Manifest V3) — rule IDs are integers, not strings. The ruleset ID `"ruleset_1"` must match `manifest.json`'s `rule_resources[0].id`.
- **Feed lazy-load fix** lives in two places. The MAIN-world `IntersectionObserver` patch is in `src/inject/inject.js` — a patch placed in an isolated-world content script would patch a separate `window.IntersectionObserver` that the page never sees. `FeedBootstrap` in `src/content/content-feed.js` then drives initial load with a multi-pass `min-height` nudge (3 hold/release cycles, ~520ms). A periodic safety net re-nudges until the first non-shorts shelf has ≥ `FEED_EMPTY_SHELF_MIN_ITEMS` items.
- **PostImages** in `src/content/content-feed.js` enhances how post images look on desktop. It uses a single `MutationObserver` over `document.body` and does three things:
  1. **Hi-res URL rewriting (B4)**: for every `ytm-backstage-image-renderer img` whose rendered width is ≥ `POST_IMAGE_HI_RES_MIN_PX` (600), rewrite `=w\d+`, `=s\d+`, and `-w\d+-h\d+` segments in `src` / `srcset` to `POST_IMAGE_HI_RES_TARGET_W` (1280). Guarded by `data-yt-ext-hi-res="1"` so it's idempotent. Falls through silently if the URL has no size param.
  2. **Carousel end detection (C7)**: sets `data-yt-ext-carousel-end="0"|"1"` on every `ytm-post-multi-image-renderer` based on whether the user has scrolled to the end; the CSS uses this to hide the right-edge fade gradient. A `ResizeObserver` re-runs the check when the container resizes.
  3. **Load tracking (D11)**: sets `data-yt-ext-loaded="1"` on each `img` once it has decoded (handles both `load`/`error` and the cached `complete` case); the CSS uses `[data-yt-ext-loaded]:not(...)` to gate the fade-in keyframe.
  PostImages is gated to `State.mobile === true` and started/stopped by the same `mobile` change handler that toggles `MobileLayout`. Tunables live in `CONFIG.POST_IMAGE_*`.
- **Post image CSS** caps the post card to `clamp(560px, 60vw, 720px)` and centres it. Single-image post containers use `max-height: clamp(360px, 65vh, 620px)` so they fill available desktop space. Carousel cells are 50% wide × 4:5 aspect by default (2 visible at a time, with real visual weight), narrowing to 33.333% on viewports ≥ 992px (3 visible at a time). The carousel uses `scroll-snap-type: x mandatory`, hidden native scrollbar, and a CSS-only right-edge fade gradient via `::after`.

## File responsibilities

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, content scripts, service worker |
| `src/background/background.js` | Service worker — toggles UA ruleset, reloads tabs |
| `src/content/content-core.js` | Shared isolated-world config, state, and utilities exposed on `globalThis.YTME` |
| `src/content/content-player.js` | Video cache, volume boost, HUD, volume panel, keyboard controls, idle cursor, video lifecycle |
| `src/content/content-mobile.js` | Mobile layout class toggling, watch-page Shorts hiding, and watch sidebar bootstrap (`SidebarBootstrap`) |
| `src/content/content-feed.js` | Feed bootstrap and post image enhancements |
| `src/content/content-preview.js` | Hover-to-preview thumbnail iframe UI |
| `src/content/content.js` | Isolated-world bootstrap, event wiring, storage sync |
| `src/inject/inject.js` | MAIN world script — background playback spoofing, History API hooks, IntersectionObserver patch |
| `styles/content-core.css` | Shared CSS variables |
| `styles/content-player.css` | HUD, volume panel, cursor hiding, player controls |
| `styles/content-preview.css` | Hover preview styles |
| `styles/content-mobile.css` | Mobile layout, post images, watch sidebar |
| `popup/popup.html`/`popup/popup.js` | Popup UI with feature toggles |
| `rules.json` | DeclarativeNetRequest rules (mobile UA, strip `app=` param) |

## Testing

There are no automated tests. Manual testing: load as unpacked extension in Chrome, open YouTube, verify mobile layout, keyboard shortcuts (Space, arrows, M, F, Shift+arrows), volume panel, background playback, and video preview on hover.

Feed bootstrap: on a fresh load of `m.youtube.com` (no scroll), the first non-shorts shelf should contain ≥ 4 `ytm-rich-item-renderer` items above the first Shorts/post/poll shelf. Confirm `document.documentElement.dataset.ytExtIoPatched === "1"` in DevTools console. As you scroll, no empty shelf sections should appear, and items should not be inserted retrospectively after you scroll back up.
