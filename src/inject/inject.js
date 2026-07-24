(() => {
  "use strict";

  const CONFIG = Object.freeze({
    ACTIVITY_MIN_DELAY_MS: 55000,
    ACTIVITY_MAX_DELAY_MS: 65000,

    /* IntersectionObserver widening for mobile feed lazy grid */
    IO_ROOT_MARGIN_BOTTOM_PX: 5000,
    IO_ROOT_MARGIN_TOP_PX: 500,
    IO_ROOT_MARGIN_SIDE_PX: 500,
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

  /* Cleanup on page unload */
  window.addEventListener("pagehide", stopActivity);
  window.addEventListener("beforeunload", stopActivity);
})();
