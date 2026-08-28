(() => {
  "use strict";

  if (location.hostname === "studio.youtube.com") return;

  const CONFIG = Object.freeze({
    ACTIVITY_MIN_DELAY_MS: 55000,
    ACTIVITY_MAX_DELAY_MS: 65000,

    /* IntersectionObserver widening for mobile feed lazy grid */
    IO_ROOT_MARGIN_BOTTOM_PX: 5000,
    IO_ROOT_MARGIN_TOP_PX: 500,
    IO_ROOT_MARGIN_SIDE_PX: 500,

    /* Top controls and settings bottom-sheet fullscreen interaction */
    TOP_CONTROLS_INTERACTION_TIMEOUT_MS: 500,
    TOP_CONTROLS_SELECTOR: [
      "player-top-controls",
      ".player-controls-top",
      ".player-settings-icon",
      "ytm-closed-captioning-button",
      "player-autonav-toggle",
      "bottom-sheet-container",
      "bottom-sheet-layout",
      "player-settings-menu",
      "yt-list-item-view-model",
      "ytm-menu-item",
      "ytw-scrim",
      "[aria-label*='Setting' i]",
      "[aria-label*='Quality' i]",
      "[aria-label*='Speed' i]",
      "[aria-label*='Subtitle' i]",
      "[aria-label*='Audio' i]",
    ].join(", "),
  });

  /* ===========================================================================
   * IntersectionObserver patch — runs in MAIN world so YouTube's lazy grid
   * (`ytm-rich-grid-renderer`, etc.) actually sees it. Patches placed in the
   * isolated world (content.js) only affect that world's separate
   * `window.IntersectionObserver` and are invisible to the page.
   *
   * Effect: the bottom-margin of every observer is widened by 5000px, so the
   * grid's sentinel is considered "intersecting" from the moment it is
   * observed, and its load callback fires immediately. Top/sides are widened
   * by a small amount so a small scroll doesn't unmount items.
   * =========================================================================== */
  (() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.__ytExtIOPatched) return;

    const Native = IntersectionObserver;
    const parsePx = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };

    const widenRootMargin = (opts) => {
      const o = {};
      if (opts) {
        const keys = ["root", "rootMargin", "threshold", "scrollMargin", "delay"];
        for (const k of keys) {
          if (k in opts) {
            try { o[k] = opts[k]; } catch (e) {}
          }
        }
      }
      if (!("rootMargin" in o)) o.rootMargin = "0px";
      const parts = o.rootMargin.trim().split(/\s+/);
      const m = [parts[0] || "0px", parts[1] || "0px",
                 parts[2] || "0px", parts[3] || "0px"];
      m[0] = (parsePx(m[0]) + CONFIG.IO_ROOT_MARGIN_TOP_PX) + "px";
      m[1] = (parsePx(m[1]) + CONFIG.IO_ROOT_MARGIN_SIDE_PX) + "px";
      m[2] = (parsePx(m[2]) + CONFIG.IO_ROOT_MARGIN_BOTTOM_PX) + "px";
      m[3] = (parsePx(m[3]) + CONFIG.IO_ROOT_MARGIN_SIDE_PX) + "px";
      o.rootMargin = m.join(" ");
      return o;
    };

    function Shimmed(callback, options) {
      const widened = widenRootMargin(options);
      return new Native(callback, widened);
    }
    Shimmed.prototype = Native.prototype;
    try {
      Object.defineProperty(Shimmed, Symbol.hasInstance, {
        value: (instance) => instance instanceof Native,
        configurable: true,
        writable: true,
      });
    } catch (e) {}
    try {
      window.IntersectionObserver = Shimmed;
      window.__ytExtIOPatched = true;
      try {
        document.documentElement.dataset.ytExtIoPatched = "1";
      } catch (e) {}
    } catch (e) {}
  })();

  /* ===========================================================================
   * History API hooking — dispatches "yt-nav" on SPA navigation
   * =========================================================================== */
  if (!history.__ytHooked) {
    history.__ytHooked = true;
    ["pushState", "replaceState"].forEach((m) => {
      const orig = history[m];
      history[m] = function (...a) {
        orig.apply(this, a);
        window.dispatchEvent(new Event("yt-nav"));
      };
    });
  }

  /* ===========================================================================
   * Background playback — spoof visibility to keep audio alive
   * =========================================================================== */
  let bgApplied = false;
  let activityInterval = null;

  const applyBackgroundPlay = () => {
    if (bgApplied) return;
    bgApplied = true;

    const spoof = (proto, prop, val) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (desc?.configurable) Object.defineProperty(proto, prop, { get: () => val });
        else if (document[prop] !== undefined) Object.defineProperty(document, prop, { get: () => val });
      } catch (e) {}
    };

    try {
      spoof(Document.prototype, "hidden", false);
      spoof(Document.prototype, "visibilityState", "visible");

      const origAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === "visibilitychange") return;
        return origAddEventListener.call(this, type, listener, options);
      };

      if (navigator.mediaSession) {
        Object.defineProperty(navigator.mediaSession, "playbackState", {
          get: () => "playing", configurable: true,
        });
      }
    } catch (e) {}
  };

  const simulateActivity = () => {
    const dispatchAltKey = (type) => {
      try {
        document.dispatchEvent(
          new KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Alt", code: "AltLeft" })
        );
      } catch (e) {}
    };
    const pressAltKey = () => {
      dispatchAltKey("keydown");
      dispatchAltKey("keyup");
    };
    const scheduleNext = () => {
      const delay = CONFIG.ACTIVITY_MIN_DELAY_MS + Math.floor(Math.random() * (CONFIG.ACTIVITY_MAX_DELAY_MS - CONFIG.ACTIVITY_MIN_DELAY_MS));
      activityInterval = setTimeout(() => {
        if (activityInterval) {
          pressAltKey();
          scheduleNext();
        }
      }, delay);
    };
    scheduleNext();
  };

  const stopActivity = () => {
    if (activityInterval) {
      clearTimeout(activityInterval);
      activityInterval = null;
    }
  };

  /* Listen for toggle commands from content script (isolated world) */
  window.addEventListener("yt-ext-bg-toggle", (e) => {
    if (e.detail?.enabled) {
      applyBackgroundPlay();
      simulateActivity();
    } else {
      stopActivity();
    }
  });

  /* ===========================================================================
   * Top controls fullscreen interaction & bottom-sheet relocator:
   * YouTube Mobile drops clicks on inline top controls (.player-settings-icon,
   * captions, autoplay) when document.fullscreenElement is active.
   * We intercept interactions on top controls and spoof fullscreenElement as null
   * during the event window so YouTube's event dispatcher cleanly opens the
   * settings menu bottom sheet and toggles captions/autoplay.
   *
   * When opened in fullscreen, <bottom-sheet-container> is appended by YouTube to
   * ytm-app (behind the fullscreen player). The relocator moves it inside
   * #player-container-id so it renders on the browser's fullscreen Top Layer.
   * =========================================================================== */
  (() => {
    let isInteracting = false;
    let timer = null;

    const markInteracting = (e) => {
      if (e.target?.closest?.(CONFIG.TOP_CONTROLS_SELECTOR)) {
        isInteracting = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          isInteracting = false;
          timer = null;
        }, CONFIG.TOP_CONTROLS_INTERACTION_TIMEOUT_MS);
      }
    };

    ["pointerdown", "mousedown", "touchstart", "click"].forEach((evt) => {
      window.addEventListener(evt, markInteracting, { capture: true, passive: true });
      document.addEventListener(evt, markInteracting, { capture: true, passive: true });
    });

    const origProtoFs = Object.getOwnPropertyDescriptor(Document.prototype, "fullscreenElement");
    const origProtoWebkitFs = Object.getOwnPropertyDescriptor(Document.prototype, "webkitFullscreenElement");

    const getNativeFullscreenElement = () => {
      try {
        if (origProtoFs?.get) return origProtoFs.get.call(document);
        if (origProtoWebkitFs?.get) return origProtoWebkitFs.get.call(document);
      } catch (e) {}
      return null;
    };

    const patchDoc = (target) => {
      if (!target) return;
      try {
        Object.defineProperty(target, "fullscreenElement", {
          get() {
            if (isInteracting) return null;
            try {
              const receiver = (this instanceof Document) ? this : document;
              return origProtoFs?.get ? origProtoFs.get.call(receiver) : null;
            } catch (e) {
              return null;
            }
          },
          configurable: true,
          enumerable: true,
        });

        Object.defineProperty(target, "webkitFullscreenElement", {
          get() {
            if (isInteracting) return null;
            try {
              const receiver = (this instanceof Document) ? this : document;
              return origProtoWebkitFs?.get ? origProtoWebkitFs.get.call(receiver) : null;
            } catch (e) {
              return null;
            }
          },
          configurable: true,
          enumerable: true,
        });
      } catch (e) {}
    };

    patchDoc(document);
    patchDoc(Document.prototype);

    /* Move bottom-sheet-container inside the fullscreen player container so it renders on top of the video */
    const moveSheetToFullscreen = () => {
      const fsEl = getNativeFullscreenElement();
      if (!fsEl) return;
      const playerContainer = document.getElementById("player-container-id");
      const targetContainer = (fsEl === playerContainer || fsEl.contains(playerContainer)) ? playerContainer : fsEl;
      const sheet = document.querySelector("bottom-sheet-container");
      if (sheet && targetContainer && sheet.parentElement !== targetContainer) {
        targetContainer.appendChild(sheet);
      }
    };

    const sheetObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          moveSheetToFullscreen();
          break;
        }
      }
    });

    const initSheetObserver = () => {
      const root = document.body || document.documentElement;
      if (root) {
        sheetObserver.observe(root, { childList: true, subtree: true });
      } else {
        setTimeout(initSheetObserver, 50);
      }
    };
    initSheetObserver();

    const handleFullscreenChange = () => {
      const fsEl = getNativeFullscreenElement();
      if (!fsEl) {
        const sheet = document.querySelector("bottom-sheet-container");
        const playerContainer = document.getElementById("player-container-id");
        const app = document.querySelector("ytm-app, #app") || document.body;
        if (sheet && playerContainer && sheet.parentElement === playerContainer && app) {
          app.appendChild(sheet);
        }
      } else {
        moveSheetToFullscreen();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange, true);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange, true);
  })();

  /* Cleanup on page unload */
  window.addEventListener("pagehide", stopActivity);
  window.addEventListener("beforeunload", stopActivity);
})();
