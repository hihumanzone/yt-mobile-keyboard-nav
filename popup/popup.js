const FEATURES = Object.freeze({
  mobile: Object.freeze({ key: "ytMobileEnabled", defaultValue: true, toggleId: "toggle-mobile" }),
  background: Object.freeze({ key: "ytBackgroundEnabled", defaultValue: false, toggleId: "toggle-background" }),
  keyboard: Object.freeze({ key: "ytKeyboardEnabled", defaultValue: false, toggleId: "toggle-keyboard" }),
  preview: Object.freeze({ key: "ytPreviewEnabled", defaultValue: true, toggleId: "toggle-preview" }),
  previewSound: Object.freeze({ key: "ytPreviewSoundEnabled", defaultValue: false, toggleId: "toggle-previewsound" }),
  singleSidebar: Object.freeze({ key: "ytSingleSidebarEnabled", defaultValue: true, toggleId: "toggle-singlesidebar" }),
});

const DEPENDENCIES = Object.freeze({
  mobile: Object.freeze(["background", "keyboard", "singleSidebar"]),
  preview: Object.freeze(["previewSound"]),
});

const getFeatureToggle = (feature) => document.getElementById(FEATURES[feature].toggleId);
const getStorageKeys = () => Object.values(FEATURES).map(({ key }) => key);

document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get(getStorageKeys());

  for (const [feature, config] of Object.entries(FEATURES)) {
    const toggle = getFeatureToggle(feature);
    if (!toggle) continue;
    toggle.checked = data[config.key] ?? config.defaultValue;
    toggle.addEventListener("change", () => {
      chrome.storage.local.set({ [config.key]: toggle.checked }).catch(() => {
        toggle.checked = !toggle.checked;
      });
    });
  }

  const syncDependents = (parentFeature) => {
    const parent = getFeatureToggle(parentFeature);
    if (!parent) return;
    const enabled = parent.checked;

    (DEPENDENCIES[parentFeature] || []).forEach((feature) => {
      const toggle = getFeatureToggle(feature);
      if (!toggle) return;
      const row = toggle.closest(".row");
      toggle.disabled = !enabled;
      if (row) row.classList.toggle("disabled", !enabled);
      if (!enabled) {
        toggle.checked = false;
        chrome.storage.local.set({ [FEATURES[feature].key]: false }).catch(() => {});
      }
    });
  };

  Object.keys(DEPENDENCIES).forEach((feature) => {
    syncDependents(feature);
    getFeatureToggle(feature)?.addEventListener("change", () => syncDependents(feature));
  });
});
