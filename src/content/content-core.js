(() => {
  "use strict";

  const ns = (globalThis.YTME ||= {});
  /* ===========================================================================
   * Config — all tunable constants in one place
   * =========================================================================== */
  
  const FEATURE_DEFAULTS = Object.freeze({
    mobile: true,
    background: true,
    keyboard: true,
    preview: true,
    previewSound: false,
    singleSidebar: true,
  });

  const FEATURE_DEPENDENCIES = Object.freeze({
    mobile: Object.freeze(["background", "keyboard", "singleSidebar"]),
    preview: Object.freeze(["previewSound"]),
  });

  const CONFIG = Object.freeze({
    STORAGE_KEYS: Object.freeze({
      mobile: "ytMobileEnabled",
      background: "ytBackgroundEnabled",
      keyboard: "ytKeyboardEnabled",
      preview: "ytPreviewEnabled",
      previewSound: "ytPreviewSoundEnabled",
      singleSidebar: "ytSingleSidebarEnabled",
    }),
  
    /* Volume */
    VOL_EXP: 2.2,
    VOL_MAX: 300,
    VOL_FINE_STEP: 2,
    VOL_COARSE_STEP: 10,
  
    /* HUD */
    HUD_DURATION_MS: 1000,
    HUD_FADE_MS: 250,
    HUD_PLAY_PAUSE_SCALE: 1.2,
  
    /* Volume Panel */
    VOLUME_PANEL_DURATION_MS: 2000,
    VOLUME_HOVER_HIDE_MS: 1500,
    VOLUME_TOOLTIP_DURATION_MS: 800,
    VOLUME_TOOLTIP_LEAVE_MS: 300,
    VOLUME_TICKS: [0, 25, 50, 75, 100, 200, 300],
    VOLUME_MAJOR_TICKS: [0, 100, 300],
  
    /* Mobile Layout */
    MOBILE_FIX_DELAYS_MS: [50, 150, 300, 600, 1000, 1800, 3000],
    /* Paths where the mobile layout class (yt-mobile-mode) is added.
       Covers the home feed, channel pages (/@handle and its sub-tabs
       including /posts, /community, /videos, /shorts, /playlists,
       /channels, /featured, /about), and /watch. The /watch path is
       matched for the watch-mode class only — see MobileLayout.update(). */
    MOBILE_ALLOWED_PATHS: /^\/(?:feed|@[^/]+(?:\/(?:posts|community|videos|shorts|playlists|channels|featured|about))?|watch)?$/,
  
    /* Feed Bootstrap — forces YouTube mobile's lazy grid to materialise */
    FEED_NUDGE_PASSES: 3,
    FEED_NUDGE_HOLD_MS: 120,
    FEED_NUDGE_RELEASE_MS: 80,
    FEED_NUDGE_DELTA_PX: 1000,
    FEED_EMPTY_SHELF_MIN_ITEMS: 4,
    FEED_MUTATION_QUIET_MS: 800,
    FEED_MUTATION_RECHECK_DELAY_MS: 400,
    FEED_SAFETY_TIMEOUT_MS: 1500,
    FEED_MAX_SAFETY_NUDGES: 4,
    FEED_SAFETY_INTERVAL_MS: 700,
    FEED_KEEP_ALIVE_MS: 8000,
  
    /* Post Images — hi-res URL rewriting + carousel end fade + fade-in */
    POST_IMAGE_HI_RES_MIN_PX: 600,
    POST_IMAGE_HI_RES_TARGET_W: 1280,
    POST_IMAGE_FADE_IN_MS: 240,
    POST_IMAGE_END_FADE_PX: 32,
  
    /* Idle / Cursor */
    IDLE_TIMEOUT_MS: 1000,
    IDLE_MOVE_THROTTLE_MS: 150,
  
    /* Video Preview */
    PREVIEW_HOVER_DELAY_MS: 400,
    PREVIEW_GONE_CHECK_MS: 2000,
    PREVIEW_THUMB_MIN_W: 50,
    PREVIEW_THUMB_MIN_H: 30,
    PREVIEW_CROP_PX: 100,
    PREVIEW_IFRAME_BASE: "https://www.youtube-nocookie.com/embed/",
    PREVIEW_IFRAME_PARAMS: "?enablejsapi=1&autoplay=1&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&fs=0&disablekb=1",
  
    /* Audio Engine */
    COMPRESSOR_THRESHOLD: -6,
    COMPRESSOR_KNEE: 12,
    COMPRESSOR_RATIO: 12,
    COMPRESSOR_ATTACK: 0.005,
    COMPRESSOR_RELEASE: 0.1,
  });
  
  /* ===========================================================================
   * State — central feature flags, synced from chrome.storage
   * =========================================================================== */
  
  const State = { ...FEATURE_DEFAULTS };

  const getFeatureStorageDefaults = () =>
    Object.fromEntries(
      Object.entries(CONFIG.STORAGE_KEYS).map(([feature, key]) => [key, FEATURE_DEFAULTS[feature]])
    );

  const applyStoredFeatures = (data) => {
    Object.entries(CONFIG.STORAGE_KEYS).forEach(([feature, key]) => {
      State[feature] = data[key] ?? FEATURE_DEFAULTS[feature];
    });
  };

  const getDisabledDependents = (feature) => FEATURE_DEPENDENCIES[feature] || [];

  const getDisabledDependentStorage = (feature) =>
    Object.fromEntries(
      getDisabledDependents(feature).map((dependent) => [CONFIG.STORAGE_KEYS[dependent], false])
    );
  
  const dispatchBgToggle = (enabled) => {
    if (!State.mobile && enabled) return;
    window.dispatchEvent(new CustomEvent("yt-ext-bg-toggle", { detail: { enabled } }));
  };
  
  /* ===========================================================================
   * Utilities
   * =========================================================================== */
  
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const clearTimer = (id) => id && clearTimeout(id);
  
  const isInputElement = (el) => {
    if (!el) return false;
    try {
      if (el.isContentEditable) return true;
      if (typeof el.matches === "function")
        return el.matches("input, textarea, [role='textbox'], [role='searchbox']");
    } catch (e) {}
    return false;
  };
  
  const getVideoContainer = (v) =>
    v && (v.closest(".player-container") || v.closest(".video-container") || v.closest(".ytm-video-player-renderer") || v.parentElement);
  
  const isFullscreen = () => !!document.fullscreenElement;
  
  const isPlayerUI = (el) =>
    el && el.tagName !== "VIDEO" && typeof el.closest === "function" &&
    !!el.closest(
      "button, input, a, " +
      "[role='button'], [role='slider'], [role='menu'], [role='menuitem'], [role='toolbar'], " +
      ".ytp-chrome-bottom, .ytp-chrome-top, .ytp-button, .ytp-panel, " +
      ".ytp-progress-bar-container, .ytp-popup, .ytp-ce-element, " +
      ".ytm-player-controls, .ytm-scrubber, .ytm-video-action-bar-renderer"
    );
  
  Object.assign(ns, {
    CONFIG,
    FEATURE_DEFAULTS,
    FEATURE_DEPENDENCIES,
    State,
    getFeatureStorageDefaults,
    applyStoredFeatures,
    getDisabledDependents,
    getDisabledDependentStorage,
    dispatchBgToggle,
    clamp,
    clearTimer,
    isInputElement,
    getVideoContainer,
    isFullscreen,
    isPlayerUI,
  });
})();
