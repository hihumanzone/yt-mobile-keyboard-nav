(function () {
  "use strict";

  /* ===========================================================================
   * Configuration
   * =========================================================================== */

  const CONFIG = Object.freeze({
    // Timing
    HUD_DISPLAY_DURATION: 1000,
    VOLUME_PANEL_DISPLAY_DURATION: 2000,
    VOLUME_PANEL_HOVER_DURATION: 1500,
    VIDEO_DETECTION_INTERVAL: 500,
    VOLUME_SYNC_INTERVAL: 500,
    IDLE_HIDE_DELAY: 1000,
    IDLE_MOUSE_THROTTLE: 150,

    // Controls
    VOLUME_STEP: 0.1,
    SEEK_DURATION: 10,

    // HUD scaling
    PLAY_PAUSE_SCALE: 0.85,
    HUD_REFERENCE_WIDTH: 640,
    HUD_SCALE_MIN: 0.6,
    HUD_SCALE_MAX: 1.5,
  });

  const ICON_PATHS = Object.freeze({
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    seekForward:
      "M4 13c0 4.4 3.6 8 8 8s8-3.6 8-8h-2c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6v4l5-5-5-5v4c-4.4 0-8 3.6-8 8z",
    seekBackward:
      "M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z",
    volumeHigh:
      "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
    volumeLow: "M7 9v6h4l5 5V4l-5 5H7z",
    volumeMuted:
      "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
  });

  const CSS_CLASSES = Object.freeze({
    HUD: "yt-ext-hud",
    HUD_VISIBLE: "visible",
    HUD_HIDING: "hiding",
    VOLUME_PANEL: "yt-ext-volume-panel",
    VOLUME_PANEL_VISIBLE: "visible",
    CURSOR_HIDDEN: "yt-ext-cursor-hidden",
  });

  const SELECTORS = Object.freeze({
    HUD: `.${CSS_CLASSES.HUD}`,
    VOLUME_PANEL: "#yt-ext-volume-panel",
    VOLUME_SLIDER: "#yt-ext-volume-slider",
    VOLUME_ICON_PATH: "#yt-ext-volume-icon-path",
    VOLUME_FILL: "#yt-ext-volume-fill",
    VOLUME_VALUE: "#yt-ext-volume-value",
    MUTE_BUTTON: "#yt-ext-mute-btn",
  });

  /* ===========================================================================
   * State Management
   * =========================================================================== */

  const state = {
    currentVideo: null,
    hudElement: null,
    hudTimeoutId: null,
    volumePanel: null,
    volumePanelTimeoutId: null,
    videoDetectionIntervalId: null,
    volumeSyncIntervalId: null,
    idleTimeoutId: null,
    isIdle: false,
  };

  /* ===========================================================================
   * Utility Functions
   * =========================================================================== */

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const clearTimer = (timerId) => {
    if (timerId) clearTimeout(timerId);
    return null;
  };

  const isInputElement = (element) => {
    const tagName = element?.tagName;
    return (
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      element?.isContentEditable
    );
  };

  const isMouseOverElement = (event, element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  };

  const getVideoContainer = (video) => {
    if (!video) return null;
    return (
      video.closest(".player-container") ||
      video.closest(".video-container") ||
      video.parentElement
    );
  };

  const isFullscreen = () =>
    Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
    );

  const getFullscreenContainer = () => document.fullscreenElement || document.body;

  const createSvgIcon = (pathData, includeSeekText = false) => {
    const textElement = includeSeekText
      ? `<text x="12" y="14.5" text-anchor="middle" font-size="6" font-weight="bold">${CONFIG.SEEK_DURATION}</text>`
      : "";
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${pathData}"/>${textElement}</svg>`;
  };

  /* ===========================================================================
   * Video Detection
   * =========================================================================== */

  const findActiveVideo = () => {
    const videos = document.querySelectorAll("video");

    // Priority 1: Currently playing video
    for (const video of videos) {
      if (!video.paused && video.readyState > 0) {
        return video;
      }
    }

    // Priority 2: Paused video with playback progress
    for (const video of videos) {
      if (video.readyState > 0 && video.currentTime > 0) {
        return video;
      }
    }

    return null;
  };

  const hasActiveVideo = () => findActiveVideo() !== null;

  /* ===========================================================================
   * Volume Utilities
   * =========================================================================== */

  const getVolumeIconPath = (volume, isMuted) => {
    if (isMuted || volume === 0) return ICON_PATHS.volumeMuted;
    if (volume < 0.5) return ICON_PATHS.volumeLow;
    return ICON_PATHS.volumeHigh;
  };

  const getVolumePercentage = (video) => {
    const effectiveVolume = video.muted ? 0 : video.volume;
    return Math.round(effectiveVolume * 100);
  };

  /* ===========================================================================
   * HUD Component
   * =========================================================================== */

  const HUD = {
    create() {
      const container = getFullscreenContainer();
      let hud = container.querySelector(SELECTORS.HUD);

      if (!hud) {
        hud = document.createElement("div");
        hud.className = CSS_CLASSES.HUD;
        hud.innerHTML = `
          <div class="yt-ext-hud-content" aria-live="polite" aria-atomic="true">
            <div class="yt-ext-hud-icon" aria-hidden="true"></div>
            <div class="yt-ext-hud-text"></div>
          </div>
        `;
        container.appendChild(hud);
      }

      state.hudElement = hud;
      return hud;
    },

    position(hud, video, scale = 1) {
      const rect = video.getBoundingClientRect();
      const baseScale = clamp(
        rect.width / CONFIG.HUD_REFERENCE_WIDTH,
        CONFIG.HUD_SCALE_MIN,
        CONFIG.HUD_SCALE_MAX
      );

      const isFs = isFullscreen();
      const centerX = isFs ? "50%" : `${rect.left + rect.width / 2}px`;
      const centerY = isFs ? "50%" : `${rect.top + rect.height / 2}px`;

      Object.assign(hud.style, {
        position: "fixed",
        left: centerX,
        top: centerY,
        transform: `translate(-50%, -50%) scale(${baseScale * scale})`,
      });
    },

    show(iconHtml, text = "", scale = 1) {
      const video = findActiveVideo();
      if (!video) return;

      const hud = this.create();
      const iconEl = hud.querySelector(".yt-ext-hud-icon");
      const textEl = hud.querySelector(".yt-ext-hud-text");

      iconEl.innerHTML = iconHtml;
      textEl.textContent = text;
      textEl.hidden = !text;

      this.position(hud, video, scale);

      // Reset animation state
      hud.classList.remove(CSS_CLASSES.HUD_VISIBLE, CSS_CLASSES.HUD_HIDING);
      void hud.offsetWidth; // Force reflow
      hud.classList.add(CSS_CLASSES.HUD_VISIBLE);

      // Schedule hide
      state.hudTimeoutId = clearTimer(state.hudTimeoutId);
      state.hudTimeoutId = setTimeout(() => {
        hud.classList.replace(CSS_CLASSES.HUD_VISIBLE, CSS_CLASSES.HUD_HIDING);
      }, CONFIG.HUD_DISPLAY_DURATION);
    },

    cleanup() {
      document.querySelectorAll(SELECTORS.HUD).forEach((el) => el.remove());
      state.hudElement = null;
      state.hudTimeoutId = clearTimer(state.hudTimeoutId);
    },
  };

  /* ===========================================================================
   * Volume Panel Component
   * =========================================================================== */

  const VolumePanel = {
    create() {
      if (document.querySelector(SELECTORS.VOLUME_PANEL)) {
        state.volumePanel = document.querySelector(SELECTORS.VOLUME_PANEL);
        return;
      }

      const panel = document.createElement("div");
      panel.id = "yt-ext-volume-panel";
      panel.className = CSS_CLASSES.VOLUME_PANEL;
      panel.innerHTML = `
        <button class="yt-ext-volume-btn" id="yt-ext-mute-btn" type="button" aria-label="Toggle mute">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path id="yt-ext-volume-icon-path"/>
          </svg>
        </button>
        <div class="yt-ext-slider-wrapper">
          <input
            type="range"
            id="yt-ext-volume-slider"
            min="0"
            max="100"
            value="100"
            aria-label="Volume"
          />
          <div class="yt-ext-slider-track">
            <div class="yt-ext-slider-track-bg"></div>
            <div class="yt-ext-slider-track-fill" id="yt-ext-volume-fill"></div>
          </div>
        </div>
        <span id="yt-ext-volume-value" class="yt-ext-volume-value">100%</span>
      `;

      document.body.appendChild(panel);
      state.volumePanel = panel;

      this.bindEvents(panel);
      this.syncWithVideo();
    },

    bindEvents(panel) {
      const slider = panel.querySelector(SELECTORS.VOLUME_SLIDER);
      const muteBtn = panel.querySelector(SELECTORS.MUTE_BUTTON);

      slider.addEventListener("input", this.handleSliderChange.bind(this));
      slider.addEventListener("keydown", (e) => e.stopPropagation());
      muteBtn.addEventListener("click", this.handleMuteClick.bind(this));

      panel.addEventListener("mouseenter", () => {
        state.volumePanelTimeoutId = clearTimer(state.volumePanelTimeoutId);
        if (hasActiveVideo()) {
          this.show();
          // Keep cursor visible and reset idle timer when hovering panel
          IdleManager.resetIdleTimer();
        }
      });

      panel.addEventListener("mouseleave", () => {
        state.volumePanelTimeoutId = setTimeout(
          () => this.hide(),
          CONFIG.VOLUME_PANEL_HOVER_DURATION
        );
      });
    },

    handleSliderChange(e) {
      const video = findActiveVideo();
      if (!video) return;

      const volume = e.target.value / 100;
      video.volume = volume;
      video.muted = volume === 0;

      this.updateDisplay(video);
      this.show();
    },

    handleMuteClick() {
      const video = findActiveVideo();
      if (!video) return;

      video.muted = !video.muted;
      this.updateDisplay(video);
      this.show();
    },

    updateDisplay(video) {
      const slider = document.querySelector(SELECTORS.VOLUME_SLIDER);
      const valueEl = document.querySelector(SELECTORS.VOLUME_VALUE);
      const iconPath = document.querySelector(SELECTORS.VOLUME_ICON_PATH);
      const fill = document.querySelector(SELECTORS.VOLUME_FILL);

      if (!slider || !valueEl || !iconPath || !fill) return;

      const percentage = getVolumePercentage(video);

      slider.value = percentage;
      valueEl.textContent = `${percentage}%`;
      fill.style.width = `${percentage}%`;
      iconPath.setAttribute("d", getVolumeIconPath(video.volume, video.muted));
    },

    syncWithVideo() {
      const video = findActiveVideo();
      if (video) this.updateDisplay(video);
    },

    show() {
      const panel = state.volumePanel;
      if (!panel || !hasActiveVideo()) return;

      // Ensure panel is in correct container
      const container = getFullscreenContainer();
      if (panel.parentElement !== container) {
        container.appendChild(panel);
      }

      panel.classList.add(CSS_CLASSES.VOLUME_PANEL_VISIBLE);

      state.volumePanelTimeoutId = clearTimer(state.volumePanelTimeoutId);
      state.volumePanelTimeoutId = setTimeout(
        () => this.hide(),
        CONFIG.VOLUME_PANEL_DISPLAY_DURATION
      );
    },

    hide() {
      state.volumePanel?.classList.remove(CSS_CLASSES.VOLUME_PANEL_VISIBLE);
    },
  };

  /* ===========================================================================
   * Video Controls
   * =========================================================================== */

  const VideoControls = {
    togglePlayPause(video) {
      const willPlay = video.paused;
      willPlay ? video.play() : video.pause();

      const iconPath = willPlay ? ICON_PATHS.play : ICON_PATHS.pause;
      HUD.show(createSvgIcon(iconPath), "", CONFIG.PLAY_PAUSE_SCALE);
    },

    seek(video, seconds) {
      const maxTime = video.duration || Infinity;
      video.currentTime = clamp(video.currentTime + seconds, 0, maxTime);

      const isForward = seconds > 0;
      const iconPath = isForward ? ICON_PATHS.seekForward : ICON_PATHS.seekBackward;
      const label = isForward ? `+${seconds}s` : `${seconds}s`;

      HUD.show(createSvgIcon(iconPath, true), label);
    },

    adjustVolume(video, delta) {
      video.volume = clamp(video.volume + delta, 0, 1);
      if (delta > 0) video.muted = false;

      VolumePanel.syncWithVideo();
      VolumePanel.show();

      const percentage = getVolumePercentage(video);
      const iconPath = getVolumeIconPath(video.volume, video.muted);
      HUD.show(createSvgIcon(iconPath), `${percentage}%`);
    },

    toggleMute(video) {
      video.muted = !video.muted;

      VolumePanel.syncWithVideo();

      const percentage = getVolumePercentage(video);
      const label = video.muted ? "Muted" : `${percentage}%`;
      const iconPath = getVolumeIconPath(video.volume, video.muted);
      HUD.show(createSvgIcon(iconPath), label);
    },

    toggleFullscreen() {
      const video = findActiveVideo();
      if (!video) return;

      if (isFullscreen()) {
        const exitFn =
          document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.mozCancelFullScreen;
        exitFn?.call(document);
      } else {
        const container =
          video.closest(".player-container") ||
          video.closest(".video-container") ||
          video.parentElement ||
          video;

        const requestFn =
          container.requestFullscreen ||
          container.webkitRequestFullscreen ||
          container.mozRequestFullScreen;
        requestFn?.call(container);
      }
    },
  };

  /* ===========================================================================
   * Keyboard Handler
   * =========================================================================== */

  const KEYBOARD_ACTIONS = Object.freeze({
    Space: (video) => VideoControls.togglePlayPause(video),
    KeyK: (video) => VideoControls.togglePlayPause(video),
    ArrowLeft: (video) => VideoControls.seek(video, -CONFIG.SEEK_DURATION),
    KeyJ: (video) => VideoControls.seek(video, -CONFIG.SEEK_DURATION),
    ArrowRight: (video) => VideoControls.seek(video, CONFIG.SEEK_DURATION),
    KeyL: (video) => VideoControls.seek(video, CONFIG.SEEK_DURATION),
    ArrowUp: (video) => VideoControls.adjustVolume(video, CONFIG.VOLUME_STEP),
    ArrowDown: (video) => VideoControls.adjustVolume(video, -CONFIG.VOLUME_STEP),
    KeyM: (video) => VideoControls.toggleMute(video),
    KeyF: () => VideoControls.toggleFullscreen(),
  });

  const handleKeyDown = (event) => {
    if (isInputElement(event.target)) return;

    const video = findActiveVideo();
    if (!video) return;

    const action = KEYBOARD_ACTIONS[event.code];
    if (action) {
      event.preventDefault();
      action(video);
      
      // Reset idle timer on keyboard interaction
      IdleManager.resetIdleTimer();
    }
  };

  /* ===========================================================================
   * Video State Observer
   * =========================================================================== */

  const VideoObserver = {
    start() {
      state.videoDetectionIntervalId = setInterval(
        () => this.check(),
        CONFIG.VIDEO_DETECTION_INTERVAL
      );
      this.check();
    },

    check() {
      const video = findActiveVideo();
      const hadVideo = state.currentVideo !== null;
      const hasVideo = video !== null;

      if (hasVideo && !hadVideo) {
        this.onVideoActivated(video);
      } else if (!hasVideo && hadVideo) {
        this.onVideoDeactivated();
      } else if (hasVideo && video !== state.currentVideo) {
        this.onVideoChanged(video);
      }
    },

    onVideoActivated(video) {
      state.currentVideo = video;
      VolumePanel.create();
      this.startVolumeSync();
      VolumePanel.syncWithVideo();
      
      // Start idle detection when video becomes active
      IdleManager.resetIdleTimer();
    },

    onVideoDeactivated() {
      state.currentVideo = null;
      VolumePanel.hide();
      this.stopVolumeSync();
      
      // Clean up idle detection
      IdleManager.cleanup();
    },

    onVideoChanged(video) {
      state.currentVideo = video;
      VolumePanel.syncWithVideo();
      
      // Reset idle detection for the new video
      IdleManager.resetIdleTimer();
    },

    startVolumeSync() {
      if (state.volumeSyncIntervalId) return;
      state.volumeSyncIntervalId = setInterval(
        () => VolumePanel.syncWithVideo(),
        CONFIG.VOLUME_SYNC_INTERVAL
      );
    },

    stopVolumeSync() {
      if (state.volumeSyncIntervalId) {
        clearInterval(state.volumeSyncIntervalId);
        state.volumeSyncIntervalId = null;
      }
    },
  };

  /* ===========================================================================
   * Event Handlers
   * =========================================================================== */

  const handleFullscreenChange = () => {
    HUD.cleanup();

    if (state.volumePanel && hasActiveVideo()) {
      getFullscreenContainer().appendChild(state.volumePanel);
    }
  };

  const handleResize = () => {
    const hud = state.hudElement;
    if (!hud?.classList.contains(CSS_CLASSES.HUD_VISIBLE)) return;

    const video = findActiveVideo();
    if (video) HUD.position(hud, video);
  };

  /* ===========================================================================
   * Idle Detection and Auto-Hide
   * =========================================================================== */

  const IdleManager = {
    lastMouseMoveTime: 0,

    setIdle() {
      if (state.isIdle) return;
      state.isIdle = true;

      const video = findActiveVideo();
      if (!video) return;

      const videoContainer = getVideoContainer(video);
      if (videoContainer) {
        videoContainer.classList.add(CSS_CLASSES.CURSOR_HIDDEN);
      }
      video.classList.add(CSS_CLASSES.CURSOR_HIDDEN);

      VolumePanel.hide();
    },

    setActive() {
      if (!state.isIdle) return;
      state.isIdle = false;

      document.querySelectorAll(`.${CSS_CLASSES.CURSOR_HIDDEN}`).forEach((el) => {
        el.classList.remove(CSS_CLASSES.CURSOR_HIDDEN);
      });
    },

    resetIdleTimer() {
      this.setActive();
      state.idleTimeoutId = clearTimer(state.idleTimeoutId);

      const video = findActiveVideo();
      if (video && !video.paused) {
        state.idleTimeoutId = setTimeout(
          () => this.setIdle(),
          CONFIG.IDLE_HIDE_DELAY
        );
      }
    },

    handleMouseMove(event) {
      const now = Date.now();
      if (now - this.lastMouseMoveTime < CONFIG.IDLE_MOUSE_THROTTLE) {
        return;
      }
      this.lastMouseMoveTime = now;

      const video = findActiveVideo();
      if (video && isMouseOverElement(event, video)) {
        this.resetIdleTimer();
      }
    },

    handleVideoPlay(event) {
      const video = findActiveVideo();
      if (video && event.target === video) {
        this.resetIdleTimer();
      }
    },

    handleVideoPause(event) {
      const video = findActiveVideo();
      if (video && event.target === video) {
        this.cleanup();
      }
    },

    cleanup() {
      state.idleTimeoutId = clearTimer(state.idleTimeoutId);
      this.setActive();
    },
  };

  /* ===========================================================================
   * Initialization
   * =========================================================================== */

  const init = () => {
    // Start video detection
    VideoObserver.start();

    // Keyboard controls
    document.addEventListener("keydown", handleKeyDown);

    // Fullscreen handling
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);

    // Window resize
    window.addEventListener("resize", handleResize);

    // Mouse movement for idle detection
    document.addEventListener("mousemove", (e) => IdleManager.handleMouseMove(e));

    // Video play/pause events for idle detection
    document.addEventListener("play", (e) => IdleManager.handleVideoPlay(e), true);
    document.addEventListener("pause", (e) => IdleManager.handleVideoPause(e), true);

    // SPA navigation support
    const mutationObserver = new MutationObserver(() => VideoObserver.check());
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  };

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();