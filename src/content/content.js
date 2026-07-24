(() => {
  "use strict";

  const ns = (globalThis.YTME ||= {});
  const {
    CONFIG,
    State,
    applyStoredFeatures,
    getDisabledDependents,
    getDisabledDependentStorage,
    dispatchBgToggle,
    MobileLayout,
    SidebarBootstrap,
    FeedBootstrap,
    PostImages,
    VideoManager,
    VideoPreview,
  } = ns;

  /* ===========================================================================
   * Init & Storage Sync
   * =========================================================================== */
  
  let initialized = false;

  const init = () => {
    if (initialized) return;
    initialized = true;
    MobileLayout.update();
    ["popstate", "yt-nav", "yt-navigate-finish"].forEach((e) => window.addEventListener(e, MobileLayout.update));
  
    if (State.mobile) {
      FeedBootstrap.start();
      PostImages.start();
      VideoManager.start();
    }
    VideoPreview.init();
  };
  
  const applyFeatureChange = (feature, value) => {
    State[feature] = value;

    if (!value) {
      const dependents = getDisabledDependents(feature);
      if (dependents.length > 0) {
        dependents.forEach((dependent) => {
          State[dependent] = false;
        });
        chrome.storage.local.set(getDisabledDependentStorage(feature));
      }
    }

    if (feature === "mobile") {
      if (!State.mobile) {
        dispatchBgToggle(false);
        PostImages.stop();
        VideoManager.stop();
        FeedBootstrap.stop();
        SidebarBootstrap.stop();
      } else {
        PostImages.start();
        VideoManager.start();
        FeedBootstrap.start();
      }
      MobileLayout.update();
      return;
    }

    if (feature === "background") dispatchBgToggle(State.background);
    if (feature === "preview" && !State.preview) VideoPreview.hidePreview();
    if (feature === "singleSidebar") MobileLayout.update();
  };

  chrome.storage.local.get(Object.values(CONFIG.STORAGE_KEYS), (data) => {
    applyStoredFeatures(data);
    dispatchBgToggle(State.background);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  });
  
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== "local") return;
    Object.entries(CONFIG.STORAGE_KEYS).forEach(([feature, key]) => {
      if (key in changes) applyFeatureChange(feature, changes[key].newValue);
    });
  });
})();
