(() => {
  "use strict";

  const ns = (globalThis.YTME ||= {});
  const { CONFIG, State } = ns;

  /* ===========================================================================
   * FeedBootstrap — forces YouTube mobile's IntersectionObserver-based
   * lazy grid to materialise its first batch of items on small laptop
   * viewports (e.g. 1366x768) where the sentinel sits just below the fold.
   *
   * Architecture:
   *  - The MAIN-world IntersectionObserver patch lives in `inject.js`,
   *    not here. YouTube's `ytm-rich-grid-renderer` runs in the MAIN
   *    world; the isolated world has its own separate
   *    `window.IntersectionObserver` and is invisible to the page, so
   *    any patch placed in `content.js` is dead code. The MAIN-world
   *    patch widens `rootMargin` by 5000px on the bottom, making the
   *    grid's sentinel count as intersecting from the moment it is
   *    observed and firing its load callback immediately.
   *  - `multiPassNudge` — 3 hold/release cycles of `min-height` bump
   *    (~520ms total) on page load and on SPA navigation, with `resize`
   *    events between cycles. YouTube's grid uses a budgeted scheduler
   *    that only loads one batch per IO callback tick, so multiple
   *    forced ticks are needed to load multiple rows. This does NOT
   *    move the page scroll — it only bumps document height and fires
   *    synthetic resize events, so the user sees no visible jitter.
   *  - Safety net — periodic re-nudges (up to 4 rounds / 8s) until the
   *    first non-shorts shelf has ≥ FEED_EMPTY_SHELF_MIN_ITEMS items.
   *  - MutationObserver on the grid container early-exits as soon as
   *    the first non-shorts shelf reaches the minimum item count.
   *
   * Earlier revisions of this module also used 1px / 30px scroll-and-
   * restore ticks to fire non-IO lazy loaders, but those produced a
   * visible "flicker" during user scroll. The IO patch + multiPassNudge
   * cover all materialisation paths the ticks were meant to handle.
   *
   * Scope: only active when State.mobile is true AND the path is the
   * home/browse feed (NOT /watch). This avoids interfering with the
   * watch-page sidebar work already in MobileLayout.
   * =========================================================================== */
  
  const FeedBootstrap = (() => {
    const FEED_PATH_RE = /^\/(feed)?$/;
    const ITEM_SELECTOR = "ytm-rich-item-renderer, ytm-video-with-context-renderer, ytm-compact-video-renderer";
  
    let navHooked = false;
    let pathWatchT = null;
    let lastPath = "";
    let lastMutationTs = 0;
  
    let lastItemCount = 0;
  
    let nudgeT = [];
    let safetyIntervalT = null;
    let safetyTimeoutT = null;
    let safetyStartedTs = 0;
    let safetyRounds = 0;
  
    let gridMutationObserver = null;
    let mutationRecheckScheduled = false;
  
    const isFeedPath = () => FEED_PATH_RE.test(location.pathname);
    const shouldRun = () => State.mobile && isFeedPath();
  
    const multiPassNudge = () => {
      if (!shouldRun()) return;
      const target = document.documentElement || document.body;
      if (!target) return;
      nudgeT.forEach(clearTimeout);
      nudgeT = [];
      const bumped = `calc(100vh + ${CONFIG.FEED_NUDGE_DELTA_PX}px)`;
  
      target.style.minHeight = bumped;
      void target.offsetWidth;
      try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  
      const cycle = CONFIG.FEED_NUDGE_HOLD_MS + CONFIG.FEED_NUDGE_RELEASE_MS;
      for (let i = 1; i < CONFIG.FEED_NUDGE_PASSES; i++) {
        const t = i * cycle;
        nudgeT.push(setTimeout(() => {
          if (!shouldRun()) return;
          target.style.minHeight = "";
          try { window.dispatchEvent(new Event("resize")); } catch (e) {}
        }, t - CONFIG.FEED_NUDGE_RELEASE_MS));
        nudgeT.push(setTimeout(() => {
          if (!shouldRun()) return;
          target.style.minHeight = bumped;
          void target.offsetWidth;
          try { window.dispatchEvent(new Event("resize")); } catch (e) {}
        }, t));
      }
      nudgeT.push(setTimeout(() => {
        if (!shouldRun()) return;
        target.style.minHeight = "";
        try { window.dispatchEvent(new Event("resize")); } catch (e) {}
      }, CONFIG.FEED_NUDGE_PASSES * cycle));
    };
  
    const countFirstShelfItems = () => {
      const shelves = document.querySelectorAll("ytm-rich-shelf-renderer, ytm-horizontal-card-list-renderer");
      for (const shelf of shelves) {
        if (shelf.matches("ytm-reel-shelf-renderer")) continue;
        if (shelf.querySelector("ytm-reel-shelf-renderer")) continue;
        if (shelf.querySelector('a[href*="/shorts/"]')) continue;
        return shelf.querySelectorAll(ITEM_SELECTOR).length;
      }
      return document.querySelectorAll(ITEM_SELECTOR).length;
    };
  
    const feedOrderIsCorrect = () => countFirstShelfItems() >= CONFIG.FEED_EMPTY_SHELF_MIN_ITEMS;
  
    const onGridMutation = () => {
      if (!shouldRun()) return;
      lastMutationTs = Date.now();
      const count = countFirstShelfItems();
      if (count > lastItemCount) {
        lastItemCount = count;
        if (feedOrderIsCorrect()) {
          stopMutationWatcher();
          return;
        }
      }
      if (lastItemCount === 0 && !mutationRecheckScheduled) {
        mutationRecheckScheduled = true;
        setTimeout(() => {
          mutationRecheckScheduled = false;
          if (!shouldRun()) return;
          if (Date.now() - lastMutationTs >= CONFIG.FEED_MUTATION_QUIET_MS) {
            if (!feedOrderIsCorrect()) multiPassNudge();
          }
        }, CONFIG.FEED_MUTATION_RECHECK_DELAY_MS);
      }
    };
  
    const startMutationWatcher = () => {
      if (gridMutationObserver) return;
      const grid = document.querySelector("ytm-rich-grid-renderer, ytm-item-section-renderer, ytm-section-list-renderer");
      if (!grid || typeof MutationObserver === "undefined") return;
      lastMutationTs = Date.now();
      lastItemCount = countFirstShelfItems();
      gridMutationObserver = new MutationObserver(onGridMutation);
      try {
        gridMutationObserver.observe(grid, { childList: true, subtree: true });
      } catch (e) { gridMutationObserver = null; }
    };
  
    const stopMutationWatcher = () => {
      if (gridMutationObserver) {
        try { gridMutationObserver.disconnect(); } catch (e) {}
        gridMutationObserver = null;
      }
    };
  
    const stopSafety = () => {
      if (safetyIntervalT) {
        clearTimeout(safetyIntervalT);
        safetyIntervalT = null;
      }
      if (safetyTimeoutT) {
        clearTimeout(safetyTimeoutT);
        safetyTimeoutT = null;
      }
    };
  
    const safetyNudge = () => {
      if (!shouldRun()) return;
      if (feedOrderIsCorrect()) { stopSafety(); return; }
      if (safetyRounds >= CONFIG.FEED_MAX_SAFETY_NUDGES) { stopSafety(); return; }
      if (Date.now() - safetyStartedTs >= CONFIG.FEED_KEEP_ALIVE_MS) { stopSafety(); return; }
      safetyRounds++;
      multiPassNudge();
      safetyIntervalT = setTimeout(safetyNudge, CONFIG.FEED_SAFETY_INTERVAL_MS);
    };
  
    const startSafety = () => {
      if (safetyIntervalT || safetyTimeoutT) return;
      safetyStartedTs = Date.now();
      safetyRounds = 0;
      safetyTimeoutT = setTimeout(() => {
        safetyTimeoutT = null;
        safetyNudge();
      }, CONFIG.FEED_SAFETY_TIMEOUT_MS);
    };
  
    const startAll = () => {
      startMutationWatcher();
      requestAnimationFrame(() => requestAnimationFrame(multiPassNudge));
      startSafety();
    };
  
    const stopAll = () => {
      stopMutationWatcher();
      stopSafety();
      nudgeT.forEach(clearTimeout);
      nudgeT = [];
      lastItemCount = 0;
      lastMutationTs = 0;
      safetyRounds = 0;
    };
  
    const onPathChange = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      stopAll();
      if (!shouldRun()) return;
      startAll();
    };
  
    const startPathWatcher = () => {
      if (pathWatchT) return;
      lastPath = location.pathname;
      pathWatchT = setInterval(onPathChange, 300);
    };
  
    const hookNav = () => {
      if (navHooked) return;
      navHooked = true;
      window.addEventListener("yt-nav", onPathChange);
      window.addEventListener("popstate", onPathChange);
      window.addEventListener("yt-navigate-finish", onPathChange);
    };
  
    return {
      start() {
        hookNav();
        startPathWatcher();
        if (shouldRun()) startAll();
      },
      stop() {
        stopAll();
        if (pathWatchT) {
          clearInterval(pathWatchT);
          pathWatchT = null;
        }
        if (navHooked) {
          window.removeEventListener("yt-nav", onPathChange);
          window.removeEventListener("popstate", onPathChange);
          window.removeEventListener("yt-navigate-finish", onPathChange);
          navHooked = false;
        }
      },
    };
  })();
  
  /* ===========================================================================
   * PostImages — enhances how post images look on desktop:
   *   - B4: rewrite =w\d+ / =s\d+ / =h\d+ URL params to a higher resolution
   *         on any post image that renders wider than POST_IMAGE_HI_RES_MIN_PX
   *   - C7: mark each carousel as data-yt-ext-carousel-end="0"|"1" so the CSS
   *         right-edge fade can be hidden when the user has scrolled to the end
   *   - D11: set data-yt-ext-loaded="1" on images once they have decoded, so
   *          the CSS fade-in keyframe plays once and then stays visible
   *
   * All work is gated to State.mobile === true and uses a single
   * MutationObserver so we don't stack observers.
   * =========================================================================== */
  
  const PostImages = (() => {
    /* Hi-res + load tracking apply to any post image renderer, including
       those embedded in older ytm-shared-post-renderer variants that may
       appear on channel/community pages. The Carousel selector stays
       specific since it targets the multi-image renderer. */
    const POST_IMG_SEL = "ytm-backstage-image-renderer img, ytm-shared-post-renderer img";
    const CAROUSEL_SEL = "ytm-post-multi-image-renderer";
    const HI_RES_FLAG = "ytExtHiRes";
    const LOADED_FLAG = "ytExtLoaded";
    const CAROUSEL_END_FLAG = "ytExtCarouselEnd";
    const END_EPS = 2;
  
    let observer = null;
    const wiredCarousels = new Map();
    const resizeObservers = new Set();
  
    const upgradeSrc = (img) => {
      if (!img || img.dataset[HI_RES_FLAG] === "1") return;
      const src = img.currentSrc || img.src || "";
      if (!src) return;
      if (!/(?:=w\d+|=[sh]\d+|-w\d+-h\d+)/.test(src)) return;
  
      const rect = (() => {
        try { return img.getBoundingClientRect(); } catch (e) { return { width: 0 }; }
      })();
      if (rect.width < CONFIG.POST_IMAGE_HI_RES_MIN_PX) return;
  
      const target = CONFIG.POST_IMAGE_HI_RES_TARGET_W;
      let upgraded = src;
      let changed = false;
  
      upgraded = upgraded.replace(/=w(\d+)(-h\d+)?/g, (m, w, h) => {
        const curW = Number(w);
        if (curW >= target) return m;
        changed = true;
        return `=w${target}`;
      });
      upgraded = upgraded.replace(/-w(\d+)-h(\d+)/g, (m, w) => {
        const curW = Number(w);
        if (curW >= target) return m;
        changed = true;
        return `-w${target}-`;
      });
      upgraded = upgraded.replace(/=s(\d+)/g, (m, s) => {
        const cur = Number(s);
        if (cur >= target) return m;
        changed = true;
        return `=s${target}`;
      });
  
      if (!changed) return;
  
      img.dataset[HI_RES_FLAG] = "1";
      try {
        img.src = upgraded;
        const srcset = img.getAttribute("srcset");
        if (srcset) {
          const next = srcset.replace(/=w(\d+)(-h\d+)?/g, (m, w) => {
            return Number(w) >= target ? m : `=w${target}`;
          });
          if (next !== srcset) img.setAttribute("srcset", next);
        }
      } catch (e) {
        img.dataset[HI_RES_FLAG] = "0";
      }
    };
  
    const markLoaded = (img) => {
      if (!img || img.dataset[LOADED_FLAG] === "1") return;
      const done = () => {
        if (img.dataset[LOADED_FLAG] === "1") return;
        if (img.naturalWidth > 0 || img.complete) img.dataset[LOADED_FLAG] = "1";
      };
      if (img.complete) done();
      else img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    };
  
    const updateCarouselEnd = (root) => {
      if (!root) return;
      const overflows = root.scrollWidth > root.clientWidth + END_EPS;
      if (!overflows) {
        root.dataset[CAROUSEL_END_FLAG] = "1";
        return;
      }
      const atEnd = root.scrollLeft + root.clientWidth >= root.scrollWidth - END_EPS;
      root.dataset[CAROUSEL_END_FLAG] = atEnd ? "1" : "0";
    };
  
    const wireCarousel = (root) => {
      if (!root || wiredCarousels.has(root)) return;
      const onScroll = () => updateCarouselEnd(root);
      wiredCarousels.set(root, onScroll);
      root.addEventListener("scroll", onScroll, { passive: true });
      updateCarouselEnd(root);
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => updateCarouselEnd(root)) : null;
      if (ro) {
        resizeObservers.add(ro);
        ro.observe(root);
      }
    };
  
    const handleImg = (img) => {
      if (!(img instanceof HTMLImageElement)) return;
      upgradeSrc(img);
      markLoaded(img);
      if (img.isConnected) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 0) {
          requestAnimationFrame(() => upgradeSrc(img));
        } else {
          const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
            if (img.getBoundingClientRect().width > 0) {
              upgradeSrc(img);
              ro.disconnect();
              resizeObservers.delete(ro);
            }
          }) : null;
          if (ro) {
            resizeObservers.add(ro);
            ro.observe(img);
          }
        }
      }
    };
  
    const handleSubtree = (root) => {
      if (!root || root.nodeType !== 1) return;
      if (root.matches?.(POST_IMG_SEL)) handleImg(root);
      if (root.querySelectorAll) {
        root.querySelectorAll(POST_IMG_SEL).forEach(handleImg);
        root.querySelectorAll(CAROUSEL_SEL).forEach(wireCarousel);
      }
    };
  
    const start = () => {
      if (observer) return;
      handleSubtree(document.body);
      observer = new MutationObserver((muts) => {
        for (const m of muts) {
          m.addedNodes.forEach((n) => handleSubtree(n));
        }
      });
      try { observer.observe(document.body, { childList: true, subtree: true }); } catch (e) { observer = null; }
    };
  
    const stop = () => {
      if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
      wiredCarousels.forEach((onScroll, root) => {
        try { root.removeEventListener("scroll", onScroll); } catch (e) {}
      });
      wiredCarousels.clear();
      resizeObservers.forEach((ro) => {
        try { ro.disconnect(); } catch (e) {}
      });
      resizeObservers.clear();
    };
  
    return { start, stop };
  })();
  
  Object.assign(ns, { FeedBootstrap, PostImages });
})();
