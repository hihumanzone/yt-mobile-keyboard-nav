(() => {
  "use strict";

  const ns = (globalThis.YTME ||= {});
  const { CONFIG, State, clearTimer, isInputElement } = ns;

  /* ===========================================================================
   * VideoPreview — hover-to-preview on video thumbnails
   * =========================================================================== */
  
  const VideoPreview = (() => {
    const CARD_SELECTORS = [
      "ytm-rich-item-renderer",
      "ytm-video-with-context-renderer",
      "ytm-compact-video-renderer",
      "ytm-large-media-item",
      "ytm-shorts-lockup-view-model",
      "ytm-shorts-lockup-view-model-v2",
    ].join(", ");
  
    const MUTE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3z"/>
      <path class="yt-ext-wave-1" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
      <path class="yt-ext-wave-2" d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      <line class="yt-ext-mute-line" x1="19" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  
    let hoverTimer = null;
    let activePreview = null;
    let activeIframe = null;
    let activeMuteBtn = null;
    let activeCard = null;
    let isMuted = true;
    let isPlaying = false;
    let messageHandler = null;
    let previewChecker = null;
    const getCardFromTarget = (el) => {
      if (!el || typeof el.closest !== "function") return null;
      return el.closest(CARD_SELECTORS);
    };
  
    const getVideoId = (card, img) => {
      img = img || card.querySelector('img[src*="/vi/"]') || card.querySelector('img[src*="ytimg"]');
      const searchRoot = img ? (img.closest("a")?.parentElement || img.parentElement || card) : card;
      const link = searchRoot.querySelector('a[href*="/watch?v="]');
      if (link) {
        try { return new URL(link.href, location.origin).searchParams.get("v"); } catch (e) {}
      }
      const shortsLink = searchRoot.querySelector('a[href*="/shorts/"]');
      if (shortsLink) {
        try {
          const match = shortsLink.href.match(/\/shorts\/([^/?]+)/);
          if (match) return match[1];
        } catch (e) {}
      }
      if (img) {
        const match = img.src.match(/\/vi\/([^/]+)/);
        if (match) return match[1];
      }
      return null;
    };
  
    const findThumb = (card) => {
      const img = card.querySelector('img[src*="/vi/"]') || card.querySelector('img[src*="ytimg"]');
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      if (rect.width > CONFIG.PREVIEW_THUMB_MIN_W && rect.height > CONFIG.PREVIEW_THUMB_MIN_H) return { container: img.parentElement, img };
      let el = img.parentElement;
      while (el && el !== card) {
        const r = el.getBoundingClientRect();
        if (r.width > CONFIG.PREVIEW_THUMB_MIN_W && r.height > CONFIG.PREVIEW_THUMB_MIN_H) return { container: el, img };
        el = el.parentElement;
      }
      return null;
    };
  
    const buildIframeSrc = (videoId) => {
      const muteParam = isMuted ? "&mute=1" : "&mute=0";
      return CONFIG.PREVIEW_IFRAME_BASE + videoId + CONFIG.PREVIEW_IFRAME_PARAMS + muteParam;
    };
  
    const findCardAnchor = (card) =>
      card.querySelector('a[href*="/shorts/"]') || card.querySelector('a[href*="/watch?v="]');
  
    const sendCommand = (iframe, func, args) => {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: "command", func, args: args || [],
        }), "*");
      } catch (e) {}
    };
  
    const updateMuteBtn = () => {
      if (!activeMuteBtn || !(activeMuteBtn instanceof HTMLElement)) return;
      activeMuteBtn.classList.toggle("yt-ext-muted", isMuted);
    };
  
    const togglePlayPause = () => {
      if (!activeIframe) return;
      isPlaying = !isPlaying;
      sendCommand(activeIframe, isPlaying ? "playVideo" : "pauseVideo");
    };

    const toggleMute = () => {
      if (!activeIframe) return;
      isMuted = !isMuted;
      sendCommand(activeIframe, isMuted ? "mute" : "unMute");
      updateMuteBtn();
    };
  
    const onMessage = (e) => {
      if (!activeIframe || e.source !== activeIframe.contentWindow) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data.event === "onReady") {
          sendCommand(activeIframe, "playVideo");
          isPlaying = true;
        } else if (data.event === "infoDelivery" && data.info) {
          if (data.info.playerState === 1) {
            isPlaying = true;
          } else if (data.info.playerState === 2) {
            isPlaying = false;
          }
        }
      } catch (err) {}
    };

    const handlePreviewKeyDown = (e) => {
      if (!activeIframe) return;
      if (isInputElement(e.target)) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        togglePlayPause();
      } else if (e.key === "m" || e.key === "M" || e.code === "KeyM") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleMute();
      }
    };
  
    const createPreview = (card, videoId, container) => {
      if (window.getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
  
      isMuted = !State.previewSound;
      isPlaying = true;
  
      const anchor = findCardAnchor(card);
  
      const safeWrap = document.createElement("div");
      safeWrap.className = "yt-ext-safe-wrap";
      safeWrap.style.setProperty("--crop", CONFIG.PREVIEW_CROP_PX + "px");
  
      const skeleton = document.createElement("div");
      skeleton.className = "yt-ext-preview-skeleton";
      skeleton.innerHTML = '<div class="yt-ext-preview-spinner"></div>';
  
      const iframe = document.createElement("iframe");
      iframe.src = buildIframeSrc(videoId);
      iframe.allow = "autoplay; encrypted-media";
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowfullscreen", "");
      iframe.style.cssText = "pointer-events:none;";
  
      const muteBtn = document.createElement("button");
      muteBtn.className = "yt-ext-preview-mute-btn" + (isMuted ? " yt-ext-muted" : "");
      muteBtn.type = "button";
      muteBtn.setAttribute("aria-label", "Toggle mute");
      muteBtn.innerHTML = MUTE_SVG;
  
      safeWrap.appendChild(skeleton);
      safeWrap.appendChild(iframe);
      safeWrap.appendChild(muteBtn);
      container.appendChild(safeWrap);
  
      if (anchor) {
        anchor.dataset.ytExtPe = anchor.style.pointerEvents || "";
        anchor.style.pointerEvents = "none";
      }
  
      safeWrap.addEventListener("click", (e) => {
        if (e.target.closest(".yt-ext-preview-mute-btn")) return;
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (anchor && anchor.href) {
          hidePreview();
        }
      });
  
      const loadTimeout = setTimeout(() => {
        skeleton.classList.add("yt-ext-skeleton-hidden");
        iframe.classList.add("yt-ext-iframe-visible");
      }, 10000);
  
      iframe.addEventListener("load", () => {
        clearTimeout(loadTimeout);
        skeleton.classList.add("yt-ext-skeleton-hidden");
        iframe.classList.add("yt-ext-iframe-visible");
        try {
          iframe.contentWindow.postMessage(JSON.stringify({
            event: "listening", id: "yt-ext-preview", channel: "widget",
          }), "*");
        } catch (e) {}
      });
  
      messageHandler = onMessage;
      window.addEventListener("message", messageHandler);
  
      activePreview = safeWrap;
      activeIframe = iframe;
      activeMuteBtn = muteBtn;
      activeCard = card;
      previewChecker = setInterval(() => {
        if (activeCard && !document.contains(activeCard)) hidePreview();
      }, CONFIG.PREVIEW_GONE_CHECK_MS);
    };
  
    const hidePreview = () => {
      hoverTimer = clearTimer(hoverTimer);
      if (previewChecker) { clearInterval(previewChecker); previewChecker = null; }
      if (messageHandler) {
        window.removeEventListener("message", messageHandler);
        messageHandler = null;
      }
      if (activeCard) {
        const anchor = findCardAnchor(activeCard) || activeCard.querySelector('a[data-yt-ext-pe]');
        if (anchor && "ytExtPe" in anchor.dataset) {
          anchor.style.pointerEvents = anchor.dataset.ytExtPe;
          delete anchor.dataset.ytExtPe;
        }
      }
      if (activePreview) {
        activePreview.remove();
        activePreview = null;
      }
      activeIframe = null;
      activeMuteBtn = null;
      activeCard = null;
      isPlaying = false;
    };
  
    const onMouseEnter = (e) => {
      if (!State.preview) return;
      const card = getCardFromTarget(e.target);
      if (!card) return;
      if (card === activeCard) return;
      const thumb = findThumb(card);
      if (!thumb) return;
      const videoId = getVideoId(card, thumb.img);
      if (!videoId) return;
      hoverTimer = clearTimer(hoverTimer);
      hoverTimer = setTimeout(() => {
        hidePreview();
        createPreview(card, videoId, thumb.container);
      }, CONFIG.PREVIEW_HOVER_DELAY_MS);
    };
  
    const onMouseLeave = (e) => {
      hoverTimer = clearTimer(hoverTimer);
      if (!activeCard) return;
      const related = e.relatedTarget;
      if (related && (activeCard.contains(related) || (activePreview && activePreview.contains(related)))) return;
      hidePreview();
    };
  
    const killPreviewEvent = (e) => {
      if (!activeMuteBtn) return;
      const path = e.composedPath();
      const isInMuteBtn = path.some(
        (el) => el === activeMuteBtn || (el instanceof HTMLElement && el.classList?.contains("yt-ext-preview-mute-btn"))
      );
      if (!isInMuteBtn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === "click" || e.type === "touchend") toggleMute();
    };
  
    return {
      init() {
        document.addEventListener("mouseenter", onMouseEnter, { capture: true });
        document.addEventListener("mouseleave", onMouseLeave, { capture: true });
        window.addEventListener("popstate", hidePreview);
        window.addEventListener("yt-nav", hidePreview);
        window.addEventListener("keydown", handlePreviewKeyDown, { capture: true });
  
        ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"].forEach(
          (type) => window.addEventListener(type, killPreviewEvent, { capture: true, passive: false })
        );
      },
      hidePreview,
    };
  })();
  
  Object.assign(ns, { VideoPreview });
})();
