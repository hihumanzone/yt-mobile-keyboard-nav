(() => {
  "use strict";

  const ns = (globalThis.YTME ||= {});
  const { CONFIG, State, clamp, clearTimer, isInputElement, getVideoContainer, isFullscreen, isPlayerUI } = ns;

  /* ===========================================================================
   * VideoCache — caches active video to avoid repeated DOM queries
   * =========================================================================== */
  
  const VideoCache = {
    _video: null,
    get() {
      // If we are on the watch page, the active video is ALWAYS the one inside the watch player container.
      // We prioritize this immediately to prevent grabbing background/autoplay videos from the home feed.
      if (location.pathname === "/watch") {
        const playerVid = document.querySelector("#player-container-id video, .player-container video");
        if (playerVid) {
          this._video = playerVid;
          return playerVid;
        }
      }
  
      let v = this._video;
      if (v && v.readyState > 0 && document.contains(v)) return v;
      const vids = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0);
      this._video = vids.find((v) => !v.paused) || vids.find((v) => v.currentTime > 0) || null;
      return this._video;
    },
    invalidate() { this._video = null; },
  };
  
  const PROGRESS_BAR_SELECTOR = ".ytp-progress-bar-container, .ytm-scrubber, .player-controls-bottom, .player-controls-bottom-bar, .ytm-player-controls-bottom";
  
  const adjustControlsPosition = () => {
    const playerControlsMiddle = document.querySelector(".player-controls-middle");
    if (!playerControlsMiddle) return;
  
    const progressBar = document.querySelector(PROGRESS_BAR_SELECTOR);
    if (!progressBar) return;
  
    if (!isFullscreen()) {
      playerControlsMiddle.style.removeProperty("bottom");
      return;
    }
  
    const activeVideo = VideoCache.get();
    const playerContainer = activeVideo
      ? getVideoContainer(activeVideo)
      : document.querySelector("#player-container-id, .player-container");
    if (!playerContainer) return;
  
    const playerRect = playerContainer.getBoundingClientRect();
    const progressRect = progressBar.getBoundingClientRect();
  
    // Anchor the controls' bottom edge to the progress bar's bottom edge (flush alignment)
    const targetBottom = playerRect.bottom - progressRect.bottom;
    playerControlsMiddle.style.setProperty("bottom", `${targetBottom}px`, "important");
  };
  
  let progressResizeObserver = null;
  
  const startProgressResizeObserver = () => {
    if (progressResizeObserver) progressResizeObserver.disconnect();
    const progressBar = document.querySelector(PROGRESS_BAR_SELECTOR);
    if (!progressBar) return;
    progressResizeObserver = new ResizeObserver(() => adjustControlsPosition());
    progressResizeObserver.observe(progressBar);
  };

  const stopProgressResizeObserver = () => {
    if (progressResizeObserver) {
      progressResizeObserver.disconnect();
      progressResizeObserver = null;
    }
    const playerControlsMiddle = document.querySelector(".player-controls-middle");
    if (playerControlsMiddle) {
      playerControlsMiddle.style.removeProperty("bottom");
    }
  };
  
  const triggerAdjust = () => {
    adjustControlsPosition();
    startProgressResizeObserver();
    setTimeout(adjustControlsPosition, 100);
    setTimeout(adjustControlsPosition, 300);
  };
  

  /* ===========================================================================
   * AudioEngine — WebAudio singleton for volume boost > 100%
   * Uses WeakMap to avoid DOM pollution
   * =========================================================================== */
  
  const AudioEngine = (() => {
    let ctx = null, gainNode = null, compNode = null;
    const videoStates = new WeakMap();
  
    const getCtx = () => {
      if (!ctx) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          ctx = new AudioCtx();
          gainNode = ctx.createGain();
          gainNode.connect(ctx.destination);
        } catch (e) {}
      }
      return ctx;
    };
  
    const ensureCompressor = () => {
      if (compNode) return;
      try {
        if (!ctx) getCtx();
        if (!ctx) return;
        gainNode.disconnect();
        compNode = ctx.createDynamicsCompressor();
        compNode.threshold.value = CONFIG.COMPRESSOR_THRESHOLD;
        compNode.knee.value = CONFIG.COMPRESSOR_KNEE;
        compNode.ratio.value = CONFIG.COMPRESSOR_RATIO;
        compNode.attack.value = CONFIG.COMPRESSOR_ATTACK;
        compNode.release.value = CONFIG.COMPRESSOR_RELEASE;
        gainNode.connect(compNode);
        compNode.connect(ctx.destination);
      } catch (e) {}
    };
  
    const getVideoState = (v) => {
      if (!v) return null;
      const src = v.src || "";
      let s = videoStates.get(v);
      if (!s) {
        s = { source: null, volume: 1.0, sliderPct: 100, lastSrc: src };
        videoStates.set(v, s);
        v.volume = 1.0;
      } else if (s.lastSrc !== src) {
        s.volume = 1.0;
        s.sliderPct = 100;
        s.lastSrc = src;
        v.volume = 1.0;
        if (gainNode) gainNode.gain.value = 1.0;
      }
      return s;
    };
  
    return {
      init(video) {
        const s = getVideoState(video);
        if (!s || s.source) return;
        const c = getCtx();
        if (!c) return;
        try { s.source = c.createMediaElementSource(video); s.source.connect(gainNode); }
        catch (e) {}
      },
      setVolume(video, vol) {
        const s = getVideoState(video);
        if (!s) return;
        s.volume = vol;
        video.volume = Math.min(vol, 1);
        if (vol > 1) { this.init(video); ensureCompressor(); }
        const c = getCtx();
        if (c?.state === "suspended") c.resume();
        if (s.source && gainNode) gainNode.gain.value = vol > 1 ? vol : 1;
      },
      setSliderPct(video, pct) {
        const s = getVideoState(video);
        if (s) s.sliderPct = pct;
      },
      getEffective(video) {
        const s = getVideoState(video);
        if (!s) return video.volume;
        const base = s.volume !== undefined ? Math.min(s.volume, 1) : video.volume;
        if (Math.abs(video.volume - base) > 0.01) {
          s.volume = video.volume;
          s.sliderPct = video.volume <= 1 ? Math.pow(video.volume, 1 / CONFIG.VOL_EXP) * 100 : 100 + (video.volume - 1) * 100;
          if (gainNode) gainNode.gain.value = 1;
        }
        return s.volume !== undefined ? s.volume : video.volume;
      },
      getSliderPct(video) {
        AudioEngine.getEffective(video);
        const s = getVideoState(video);
        if (!s) return video.volume * 100;
        return s.sliderPct !== undefined ? s.sliderPct : video.volume * 100;
      },
    };
  })();
  
  /* ===========================================================================
   * Volume Math
   * =========================================================================== */
  
  const sliderToVolume = (p) => p <= 100 ? Math.pow(p / 100, CONFIG.VOL_EXP) : 1 + (p - 100) / 100;
  const getVolPct = (video) => Math.round(video.muted ? 0 : AudioEngine.getSliderPct(video));
  
  /* ===========================================================================
   * UI — HUD overlay + Volume panel
   * =========================================================================== */
  
  const ICON_PATHS = {
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    fwd: "M4 13c0 4.4 3.6 8 8 8s8-3.6 8-8h-2c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6v4l5-5-5-5v4c-4.4 0-8 3.6-8 8z",
    back: "M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z",
  };
  
  const STATIC_VOLUME_SVG = `
    <svg viewBox="0 0 24 24" class="yt-ext-volume-icon" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3z" />
      <path class="yt-ext-wave-1" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
      <path class="yt-ext-wave-2" d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      <line class="yt-ext-mute-line" x1="21" y1="3" x2="3" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>`;
  
  const createSvgIcon = (path, text = false) => {
    const t = text ? `<text x="12" y="14.5" text-anchor="middle" font-size="6" font-weight="bold">10</text>` : "";
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/>${t}</svg>`;
  };
  
  /* HUD */
  const HUD = (() => {
    let el, icon, text, showT, hideT;
  
    const ensure = (video) => {
      const parent = getVideoContainer(video);
      if (!parent) return null;
      if (el) { if (el.parentElement !== parent) parent.appendChild(el); return el; }
      el = document.createElement("div");
      el.className = "yt-ext-hud";
      el.innerHTML = `<div class="yt-ext-hud-content"><div class="yt-ext-hud-icon"></div><div class="yt-ext-hud-text"></div></div>`;
      parent.appendChild(el);
      icon = el.querySelector(".yt-ext-hud-icon");
      text = el.querySelector(".yt-ext-hud-text");
      return el;
    };
  
    return {
      show(html, str = "", scale = 1, isPP = false) {
        const video = VideoCache.get();
        if (!video) return;
        showT = clearTimer(showT);
        hideT = clearTimer(hideT);
        const hud = ensure(video);
        if (!hud) return;
        icon.innerHTML = html;
        text.textContent = str;
        text.hidden = !str;
        hud.classList.toggle("yt-ext-hud-playpause", isPP);
        hud.classList.remove("visible", "hiding");
        hud.style.transform = `translate(-50%, -50%) scale(${scale})`;
        void hud.offsetWidth;
        hud.classList.add("visible");
        showT = setTimeout(() => {
          hud.classList.replace("visible", "hiding");
          hideT = setTimeout(() => { hud?.classList.remove("visible", "hiding"); }, CONFIG.HUD_FADE_MS);
        }, CONFIG.HUD_DURATION_MS);
      },
      showVolume(video, vol, muted, str) {
        const cls = muted ? "muted" : vol === 0 ? "zero" : vol <= 50 ? "low" : vol <= 100 ? "high" : "high boosted";
        this.show(STATIC_VOLUME_SVG.replace('class="yt-ext-volume-icon"', `class="yt-ext-volume-icon ${cls}"`), str);
      },
      cleanup() {
        el?.classList.remove("visible", "hiding");
        showT = clearTimer(showT);
        hideT = clearTimer(hideT);
      },
      destroy() {
        this.cleanup();
        if (el) {
          el.remove();
          el = null;
          icon = null;
          text = null;
        }
      },
    };
  })();
  
  const VideoControls = {
    togglePlayPause(v) {
      v.paused ? v.play() : v.pause();
      HUD.show(createSvgIcon(v.paused ? ICON_PATHS.play : ICON_PATHS.pause), "", CONFIG.HUD_PLAY_PAUSE_SCALE, true);
    },
    seek(v, sec) {
      v.currentTime = clamp(v.currentTime + sec, 0, v.duration || Infinity);
      const fwd = sec > 0;
      HUD.show(createSvgIcon(fwd ? ICON_PATHS.fwd : ICON_PATHS.back, true), fwd ? `+${sec}s` : `${sec}s`);
    },
    adjustVolume(v, delta) {
      const final = VolumePanel.adjust(v, delta);
      HUD.showVolume(v, getVolPct(v), v.muted, `${final}%`);
    },
    toggleMute(v) {
      v.muted = !v.muted;
      if (!v.muted) AudioEngine.setVolume(v, AudioEngine.getEffective(v));
      VolumePanel.sync();
      VolumePanel.show();
      HUD.showVolume(v, getVolPct(v), v.muted, v.muted ? "Muted" : `${getVolPct(v)}%`);
    },
    toggleFullscreen() {
      const v = VideoCache.get();
      if (!v) return;
      if (isFullscreen()) document.exitFullscreen?.();
      else (getVideoContainer(v) || v).requestFullscreen?.();
    },
  };
  
  /* Volume Panel — defined after VideoControls */
  const VolumePanel = (() => {
    let el, slider, fill, tooltip, value, muteBtn, hideT;
    let boostUnlocked = false;
  
    const createTicks = () => {
      const c = el.querySelector("#yt-ext-volume-ticks");
      CONFIG.VOLUME_TICKS.forEach((v) => {
        const tick = document.createElement("div");
        tick.className = `yt-ext-slider-tick ${CONFIG.VOLUME_MAJOR_TICKS.includes(v) ? "major" : ""}`;
        tick.dataset.vol = v;
        c.appendChild(tick);
      });
    };
  
    const updateTicks = (max) => {
      if (!el) return;
      el.querySelectorAll(".yt-ext-slider-tick").forEach((tick) => {
        const v = Number(tick.dataset.vol);
        tick.style.left = `${(v / max) * 100}%`;
        tick.style.display = v > 100 && max <= 100 ? "none" : "";
      });
    };
  
    const doUpdate = (video, newPct) => {
      const pct = clamp(newPct, 0, CONFIG.VOL_MAX);
      const hasBoost = pct > 100;
      if (hasBoost !== boostUnlocked) {
        boostUnlocked = hasBoost;
        if (slider) slider.max = hasBoost ? CONFIG.VOL_MAX : 100;
        el?.classList.toggle("boost-unlocked", hasBoost);
        updateTicks(hasBoost ? CONFIG.VOL_MAX : 100);
      }
      const final = boostUnlocked ? pct : Math.min(pct, 100);
      AudioEngine.setVolume(video, sliderToVolume(final));
      AudioEngine.setSliderPct(video, final);
      video.muted = final === 0;
      render(video);
      show();
      return final;
    };
  
    const render = (video) => {
      if (!el) return;
      const pct = getVolPct(video);
      const disp = boostUnlocked ? pct : Math.min(pct, 100);
      slider.value = disp;
      value.textContent = `${disp}%`;
      const max = boostUnlocked ? CONFIG.VOL_MAX : 100;
      fill.style.width = `${(disp / max) * 100}%`;
      tooltip.textContent = `${disp}%`;
      tooltip.style.left = `${(disp / max) * 100}%`;
      updateTicks(max);
      const boosted = disp > 100;
      value.classList.toggle("amplified", boosted);
      el.classList.toggle("boosted", boosted);
      const svg = muteBtn.querySelector(".yt-ext-volume-icon");
      if (svg) svg.setAttribute("class", `yt-ext-volume-icon ${video.muted ? "muted" : pct === 0 ? "zero" : pct <= 50 ? "low" : pct <= 100 ? "high" : "high boosted"}`);
    };
  
    const show = () => {
      if (!el || !VideoCache.get()) return;
      el.classList.add("visible", "expanded");
      hideT = clearTimer(hideT);
      hideT = setTimeout(() => hide(), CONFIG.VOLUME_PANEL_DURATION_MS);
    };
  
    const hide = () => {
      if (boostUnlocked) {
        boostUnlocked = false;
        if (slider) slider.max = 100;
        el?.classList.remove("boost-unlocked");
        updateTicks(100);
      }
      el?.classList.remove("visible", "expanded");
    };
  
    return {
      create(video) {
        const parent = getVideoContainer(video);
        if (!parent) return;
        if (el) { if (el.parentElement !== parent) parent.appendChild(el); return; }
        el = document.createElement("div");
        el.id = "yt-ext-volume-panel";
        el.className = "yt-ext-volume-panel";
        el.innerHTML = `
          <button class="yt-ext-volume-btn" id="yt-ext-mute-btn" type="button" aria-label="Toggle mute">${STATIC_VOLUME_SVG}</button>
          <div class="yt-ext-slider-wrapper">
            <input type="range" id="yt-ext-volume-slider" min="0" max="100" value="100" aria-label="Volume" />
            <div id="yt-ext-volume-tooltip" class="yt-ext-slider-tooltip">100%</div>
            <div class="yt-ext-slider-track">
              <div class="yt-ext-slider-track-bg"></div>
              <div id="yt-ext-volume-fill" class="yt-ext-slider-fill"></div>
              <div class="yt-ext-slider-zone-divider"></div>
            </div>
            <div id="yt-ext-volume-ticks" class="yt-ext-slider-ticks"></div>
          </div>
          <span id="yt-ext-volume-value" class="yt-ext-volume-value">100%</span>`;
        parent.appendChild(el);
        slider = el.querySelector("#yt-ext-volume-slider");
        fill = el.querySelector("#yt-ext-volume-fill");
        tooltip = el.querySelector("#yt-ext-volume-tooltip");
        value = el.querySelector("#yt-ext-volume-value");
        muteBtn = el.querySelector("#yt-ext-mute-btn");
        createTicks();
        updateTicks(100);
  
        let tipT;
        slider.addEventListener("input", (e) => {
          const v = VideoCache.get();
          if (!v) return;
          doUpdate(v, Number(e.target.value));
          tooltip.classList.add("visible");
          clearTimeout(tipT);
        });
        slider.addEventListener("change", () => { tipT = setTimeout(() => tooltip.classList.remove("visible"), CONFIG.VOLUME_TOOLTIP_DURATION_MS); });
        slider.addEventListener("keydown", (e) => e.stopPropagation());
        muteBtn.addEventListener("click", () => { const v = VideoCache.get(); if (v) VideoControls.toggleMute(v); });
        const wrap = el.querySelector(".yt-ext-slider-wrapper");
        wrap.addEventListener("mouseenter", () => { tooltip.classList.add("visible"); clearTimeout(tipT); });
        wrap.addEventListener("mouseleave", () => { tipT = setTimeout(() => tooltip.classList.remove("visible"), CONFIG.VOLUME_TOOLTIP_LEAVE_MS); });
        el.addEventListener("mouseenter", () => { hideT = clearTimer(hideT); if (VideoCache.get()) { show(); IdleManager.reset(); } });
        el.addEventListener("mouseleave", () => { hideT = setTimeout(() => hide(), CONFIG.VOLUME_HOVER_HIDE_MS); });
        render(video);
      },
      sync() { const v = VideoCache.get(); if (v) render(v); },
      adjust(video, delta) {
        const pct = getVolPct(video);
        if (pct > 100 || (delta > 0 && pct === 100)) boostUnlocked = true;
        return doUpdate(video, pct + delta);
      },
      show,
      hide,
      destroy() {
        if (el) {
          el.remove();
          el = null;
          slider = null;
          fill = null;
          tooltip = null;
          value = null;
          muteBtn = null;
        }
        boostUnlocked = false;
        this.hide();
      },
    };
  })();
  
  /* ===========================================================================
   * Idle Manager — hides cursor after inactivity
   * =========================================================================== */
  
  const IdleManager = {
    timer: null, lastMove: 0, lastX: undefined, lastY: undefined,
    setIdle(idle) {
      const v = VideoCache.get();
      if (!v) return;
      [v, getVideoContainer(v)].filter(Boolean).forEach((el) => el.classList.toggle("yt-ext-cursor-hidden", idle));
      if (idle) VolumePanel.hide();
    },
    reset() {
      this.setIdle(false);
      adjustControlsPosition();
      this.timer = clearTimer(this.timer);
      const v = VideoCache.get();
      if (v && !v.paused) {
        const checkIdle = () => {
          const vid = VideoCache.get();
          if (!vid || vid.paused) return;
          let target = null;
          if (typeof this.lastX === "number" && typeof this.lastY === "number") {
            target = document.elementFromPoint(this.lastX, this.lastY);
          }
          if (target && (target.closest("#yt-ext-volume-panel") || target.closest(".yt-ext-hud") || isPlayerUI(target))) {
            this.timer = setTimeout(checkIdle, CONFIG.IDLE_TIMEOUT_MS);
            return;
          }
          this.setIdle(true);
        };
        this.timer = setTimeout(checkIdle, CONFIG.IDLE_TIMEOUT_MS);
      }
    },
    handleMouseMove(e) {
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const now = Date.now();
      if (now - this.lastMove < CONFIG.IDLE_MOVE_THROTTLE_MS) return;
      this.lastMove = now;
      const v = VideoCache.get();
      if (!v) return;
      const c = getVideoContainer(v);
      if (c || v) {
        const over = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        };
        if (over(c) || over(v)) this.reset();
        else { this.setIdle(false); this.timer = clearTimer(this.timer); }
      }
    },
    cleanup() { this.timer = clearTimer(this.timer); this.setIdle(false); },
  };
  
  /* ===========================================================================
   * Keyboard Actions
   * =========================================================================== */
  
  const KEYBOARD_ACTIONS = Object.freeze({
    Space: (v) => VideoControls.togglePlayPause(v),
    ArrowLeft: (v) => VideoControls.seek(v, -10),
    ArrowRight: (v) => VideoControls.seek(v, 10),
    ArrowUp: (v) => VideoControls.adjustVolume(v, CONFIG.VOL_COARSE_STEP),
    ArrowDown: (v) => VideoControls.adjustVolume(v, -CONFIG.VOL_COARSE_STEP),
    KeyM: (v) => VideoControls.toggleMute(v),
    KeyF: () => VideoControls.toggleFullscreen(),
  });
  
  const handleKeyDown = (e) => {
    if (!State.keyboard || !State.mobile) return;
    if (isInputElement(e.target)) return;
    const video = VideoCache.get();
    if (!video) return;
    if (e.shiftKey && (e.code === "ArrowUp" || e.code === "ArrowDown")) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      VideoControls.adjustVolume(video, e.code === "ArrowUp" ? CONFIG.VOL_FINE_STEP : -CONFIG.VOL_FINE_STEP);
      IdleManager.reset();
      return;
    }
    const action = KEYBOARD_ACTIONS[e.code];
    if (action) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      action(video);
      IdleManager.reset();
    }
  };
  
  
  /* ===========================================================================
   * VideoManager — observes video lifecycle, manages UI creation
   * =========================================================================== */
  
  const VideoManager = (() => {
    let currentVideo = null;
    let currentVideoSrc = "";
    let mutationObserver = null;
    let started = false;
  
    const trigger = (e) => { if (e.target?.tagName === "VIDEO") VideoManager.check(); };
    const handleMouseMove = (e) => IdleManager.handleMouseMove(e);
    const handleVolumeChange = (e) => {
      if (e.target?.tagName === "VIDEO") VolumePanel.sync();
    };
    const handlePlay = (e) => {
      if (e.target?.tagName === "VIDEO") IdleManager.reset();
    };
    const handlePause = (e) => {
      if (e.target?.tagName === "VIDEO") IdleManager.cleanup();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) IdleManager.cleanup();
    };
  
    return {
      start() {
        if (started) return;
        started = true;
        this.check();
        ["play", "playing", "pause", "loadedmetadata", "ended", "emptied"].forEach((ev) =>
          document.addEventListener(ev, trigger, true)
        );
        if (!mutationObserver) {
          mutationObserver = new MutationObserver(() => this.check());
          mutationObserver.observe(document.body, { childList: true, subtree: true });
        }
  
        window.addEventListener("keydown", handleKeyDown, { capture: true });
        window.addEventListener("mousemove", handleMouseMove, { capture: true });
        document.addEventListener("volumechange", handleVolumeChange, true);
        document.addEventListener("play", handlePlay, true);
        document.addEventListener("pause", handlePause, true);
        document.addEventListener("visibilitychange", handleVisibilityChange, true);
  
        ["fullscreenchange", "webkitfullscreenchange"].forEach((ev) => {
          document.addEventListener(ev, triggerAdjust);
        });
        window.addEventListener("resize", triggerAdjust);
      },
      stop() {
        if (!started) return;
        started = false;
  
        ["play", "playing", "pause", "loadedmetadata", "ended", "emptied"].forEach((ev) =>
          document.removeEventListener(ev, trigger, true)
        );
        if (mutationObserver) {
          mutationObserver.disconnect();
          mutationObserver = null;
        }
  
        window.removeEventListener("keydown", handleKeyDown, { capture: true });
        window.removeEventListener("mousemove", handleMouseMove, { capture: true });
        document.removeEventListener("volumechange", handleVolumeChange, true);
        document.removeEventListener("play", handlePlay, true);
        document.removeEventListener("pause", handlePause, true);
        document.removeEventListener("visibilitychange", handleVisibilityChange, true);
  
        ["fullscreenchange", "webkitfullscreenchange"].forEach((ev) => {
          document.removeEventListener(ev, triggerAdjust);
        });
        window.removeEventListener("resize", triggerAdjust);
  
        currentVideo = null;
        currentVideoSrc = "";
        VolumePanel.destroy();
        IdleManager.cleanup();
        HUD.destroy();
        stopProgressResizeObserver();
      },
      check() {
        VideoCache.invalidate();
        const video = VideoCache.get();
        const src = video ? (video.src || "") : "";
        if (video === currentVideo && src === currentVideoSrc) return;
        currentVideo = video;
        currentVideoSrc = src;
        if (video) {
          VolumePanel.create(video);
          VolumePanel.sync();
          IdleManager.reset();
        } else {
          VolumePanel.hide();
          IdleManager.cleanup();
          HUD.cleanup();
        }
      },
    };
  })();
  
  Object.assign(ns, { VideoCache, AudioEngine, HUD, VideoControls, VolumePanel, IdleManager, handleKeyDown, adjustControlsPosition, triggerAdjust, VideoManager });
})();
