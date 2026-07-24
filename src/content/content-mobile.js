(() => {
  "use strict";

  const ns = (globalThis.YTME ||= {});
  const { CONFIG, State, isFullscreen, adjustControlsPosition } = ns;

  /* ===========================================================================
   * MobileLayout — forces mobile YouTube to render correctly on desktop
   * =========================================================================== */
  
  const MobileLayout = (() => {
    const CLASS_BROWSE = "yt-mobile-mode";
    const CLASS_WATCH = "yt-mobile-watch-mode";
    let timeouts = [];
    let observer = null;
    let observerTarget = null;
    let pathWatcher = null;
    let lastPath = "";
  
    const STYLE_PROPS = [
      "width", "height", "maxWidth", "minWidth", "maxHeight", "minHeight",
      "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
      "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
      "transform", "scale", "zoom",
    ];
  
    const SELECTORS = [
      "ytm-rich-grid-renderer", "ytm-item-section-renderer", "ytm-section-list-renderer",
      "ytm-channel-renderer", "ytm-browse-results-renderer", "ytm-single-column-browse-results-renderer",
      "ytm-video-with-context-renderer", "ytm-reel-shelf-renderer", "ytm-rich-shelf-renderer",
      "ytm-browse", "ytm-app", "#app",
    ];
  
    const clearCachedStyles = () => {
      SELECTORS.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          STYLE_PROPS.forEach((prop) => { el.style[prop] = ""; });
        });
      });
    };
  
    const applyFix = () => {
      clearCachedStyles();
      window.dispatchEvent(new Event("resize"));
    };
  
    const scheduleFixes = () => {
      timeouts.forEach(clearTimeout);
      timeouts = [];
      applyFix();
      CONFIG.MOBILE_FIX_DELAYS_MS.forEach((d) => {
        timeouts.push(setTimeout(applyFix, d));
      });
    };
  
    const startPathWatcher = () => {
      if (pathWatcher) return;
      lastPath = location.pathname;
      pathWatcher = setInterval(() => {
        if (location.pathname !== lastPath) {
          lastPath = location.pathname;
          update();
        }
      }, 500);
    };
  
    const stopPathWatcher = () => {
      if (pathWatcher) {
        clearInterval(pathWatcher);
        pathWatcher = null;
      }
    };
  
    const setupObserver = () => {
      if (observer) observer.disconnect();
      observerTarget = document.body || document.documentElement;
      if (!observerTarget) return;
      observer = new MutationObserver(() => {
        const html = document.documentElement;
        if (html.classList.contains(CLASS_BROWSE) || html.classList.contains(CLASS_WATCH)) {
          clearCachedStyles();
        }
        const isWatchNow = /^\/watch$/.test(location.pathname);
        if (isWatchNow && !html.classList.contains(CLASS_WATCH) && State.mobile) {
          update();
        }
        if (isFullscreen()) adjustControlsPosition();
      });
      observer.observe(observerTarget, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["style"],
      });
    };
  
    const update = () => {
      const isWatch = /^\/watch$/.test(location.pathname);
      const isBrowse = CONFIG.MOBILE_ALLOWED_PATHS.test(location.pathname);
      const html = document.documentElement;
  
      const enableWatch = State.mobile && isWatch && State.singleSidebar;
      const enableBrowse = State.mobile && isBrowse;
  
      html.classList.toggle(CLASS_WATCH, enableWatch);
      html.classList.toggle(CLASS_BROWSE, enableBrowse);
  
      const shouldEnable = enableWatch || enableBrowse;
      if (shouldEnable) {
        scheduleFixes();
        setupObserver();
        startPathWatcher();
        void html.offsetHeight;
      } else {
        if (observer) observer.disconnect();
        stopPathWatcher();
      }
  
      if (State.mobile && isWatch) {
        WatchShortsHider.start();
        SidebarBootstrap.update();
      } else {
        WatchShortsHider.stop();
        SidebarBootstrap.stop();
      }
    };
  
    return { update };
  })();
  
  /* ===========================================================================
   * WatchShortsHider — removes the Shorts section from /watch pages so the
   * video suggestions are visible.
   *
   * YouTube renders the watch page in two layouts depending on
   * State.singleSidebar:
   *  - Native modern-panels (singleSidebar off): the
   *    `ytm-item-section-renderer[section-identifier="related-items"]`
   *    element IS the Shorts overlay; removing it reveals the suggestions
   *    sitting below it in the DOM (matches the manual DevTools removal).
   *  - SingleSidebar (singleSidebar on): the extension reuses the same
   *    element as the suggestions sidebar, so we only strip the
   *    `ytm-reel-shelf-renderer` Shorts shelf that sits inside it,
   *    leaving the related-video cards intact.
   *
   * Always-on while State.mobile is true; lifecycle is driven by
   * MobileLayout.update() so it tracks mobile-state changes and SPA
   * navigation automatically.
   * =========================================================================== */
  
  const WatchShortsHider = (() => {
    const RELATED_SEL = "ytm-item-section-renderer[section-identifier=\"related-items\"]";
    const REEL_SEL = "ytm-reel-shelf-renderer";
    const REMOVED_FLAG = "ytExtShortsRemoved";
  
    let observer = null;
  
    const isWatchPage = () => /^\/watch$/.test(location.pathname);
    const isActive = () => State.mobile && isWatchPage();
  
    const removeShelf = (shelf) => {
      if (!shelf || shelf.dataset[REMOVED_FLAG] === "1") return;
      shelf.dataset[REMOVED_FLAG] = "1";
      try { shelf.remove(); } catch (e) {}
    };
  
    const removeRelated = (related) => {
      if (!related || related.dataset[REMOVED_FLAG] === "1") return;
      related.dataset[REMOVED_FLAG] = "1";
      try { related.remove(); } catch (e) {}
    };
  
    const removeShortsShelves = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll(REEL_SEL).forEach(removeShelf);
    };
  
    const processNode = (node) => {
      if (!node || node.nodeType !== 1 || !isActive()) return;
  
      if (!State.singleSidebar) {
        if (node.matches?.(RELATED_SEL)) removeRelated(node);
        if (node.querySelectorAll) node.querySelectorAll(RELATED_SEL).forEach(removeRelated);
        return;
      }
  
      if (node.matches?.(RELATED_SEL)) removeShortsShelves(node);
      if (node.querySelectorAll) node.querySelectorAll(RELATED_SEL).forEach(removeShortsShelves);
      if (node.matches?.(REEL_SEL) && node.closest?.(RELATED_SEL)) removeShelf(node);
      if (node.querySelectorAll) {
        node.querySelectorAll(REEL_SEL).forEach((s) => {
          if (s.closest?.(RELATED_SEL)) removeShelf(s);
        });
      }
    };
  
    const scan = () => {
      if (!isActive()) return;
      processNode(document.body);
    };
  
    const start = () => {
      if (observer) return;
      scan();
      observer = new MutationObserver((muts) => {
        if (!isActive()) return;
        for (const m of muts) m.addedNodes.forEach(processNode);
      });
      try { observer.observe(document.body, { childList: true, subtree: true }); } catch (e) { observer = null; }
    };
  
    const stop = () => {
      if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    };
  
    return { start, stop, scan };
  })();
  
  /* ===========================================================================
   * SidebarBootstrap — ensures watch-page single sidebar (`related-items`)
   * materialises its suggestion cards when singleSidebar mode is active.
   *
   * YouTube Mobile's `related-items` section is transformed into a fixed-position
   * sidebar on the right of the screen. If `yt-mobile-watch-mode` applies before
   * YouTube's internal lazy-load logic runs, or if YouTube's scroll listeners
   * observe document scroll (which no longer scrolls the fixed sidebar), the
   * sidebar can remain completely blank (#0f0f0f).
   *
   * SidebarBootstrap detects empty sidebar states and executes multi-pass
   * synthetic scroll, resize, and layout reflow nudges to trigger YouTube's
   * continuation loader / IntersectionObserver sentinels until cards appear.
   * =========================================================================== */

  const SidebarBootstrap = (() => {
    const RELATED_SEL = "ytm-item-section-renderer[section-identifier=\"related-items\"], ytm-item-section-renderer.related-items";
    const ITEM_SEL = "ytm-compact-video-renderer, ytm-video-with-context-renderer, ytm-media-item";
    const NUDGE_DELAYS = [50, 150, 300, 600, 1200, 2000, 3500];

    let timeouts = [];
    let safetyInterval = null;
    let observer = null;

    const isWatchPage = () => /^\/watch$/.test(location.pathname);
    const shouldRun = () => State.mobile && State.singleSidebar && isWatchPage();

    const getSidebar = () => document.querySelector(RELATED_SEL);

    const countItems = (sidebar) => {
      if (!sidebar) return 0;
      return sidebar.querySelectorAll(ITEM_SEL).length;
    };

    const nudgeSidebar = () => {
      if (!shouldRun()) return false;
      const sidebar = getSidebar();
      if (!sidebar) return false;

      const items = countItems(sidebar);
      if (items > 0) {
        stopSafety();
        return true;
      }

      // 1. Synthetic scroll events & scroll position toggle on sidebar
      try {
        const curTop = sidebar.scrollTop;
        sidebar.scrollTop = curTop + 1;
        sidebar.scrollTop = curTop;
        sidebar.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch (e) {}

      // 2. Synthetic window events
      try {
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
      } catch (e) {}

      // 3. Layout reflow nudge to awaken IntersectionObserver sentinels
      try {
        const origMinHeight = sidebar.style.minHeight;
        sidebar.style.minHeight = "calc(100vh - 40px)";
        void sidebar.offsetHeight;
        sidebar.style.minHeight = origMinHeight;
      } catch (e) {}

      return countItems(sidebar) > 0;
    };

    const scheduleNudges = () => {
      clearTimeouts();
      nudgeSidebar();
      NUDGE_DELAYS.forEach((d) => {
        timeouts.push(setTimeout(() => {
          if (shouldRun()) nudgeSidebar();
        }, d));
      });
    };

    const clearTimeouts = () => {
      timeouts.forEach(clearTimeout);
      timeouts = [];
    };

    const stopSafety = () => {
      if (safetyInterval) {
        clearInterval(safetyInterval);
        safetyInterval = null;
      }
    };

    const startSafety = () => {
      stopSafety();
      let checks = 0;
      safetyInterval = setInterval(() => {
        checks++;
        if (!shouldRun() || nudgeSidebar() || checks >= 16) {
          stopSafety();
        }
      }, 500);
    };

    const setupObserver = () => {
      if (observer) return;
      observer = new MutationObserver(() => {
        if (!shouldRun()) return;
        const sidebar = getSidebar();
        if (sidebar && countItems(sidebar) === 0) {
          nudgeSidebar();
        } else if (sidebar && countItems(sidebar) > 0) {
          stopSafety();
        }
      });
      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) { observer = null; }
    };

    const start = () => {
      if (!shouldRun()) {
        stop();
        return;
      }
      scheduleNudges();
      startSafety();
      setupObserver();
    };

    const stop = () => {
      clearTimeouts();
      stopSafety();
      if (observer) {
        try { observer.disconnect(); } catch (e) {}
        observer = null;
      }
    };

    const update = () => {
      if (shouldRun()) start();
      else stop();
    };

    return { start, stop, update };
  })();
  
  Object.assign(ns, { MobileLayout, WatchShortsHider, SidebarBootstrap });
})();

