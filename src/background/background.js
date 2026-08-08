const CONFIG = Object.freeze({
  STORAGE_KEY: "ytMobileEnabled",
  RULESET_ID: "ruleset_1",
  YOUTUBE_URL_PATTERN: "*://*.youtube.com/*",
});

const sync = (on) =>
  chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: on ? [CONFIG.RULESET_ID] : [],
    disableRulesetIds: on ? [] : [CONFIG.RULESET_ID],
  });

const reloadTabs = async () =>
  (await chrome.tabs.query({ url: [CONFIG.YOUTUBE_URL_PATTERN] }))
    .filter((t) => t.url && !t.url.includes("studio.youtube.com") && !t.url.includes("music.youtube.com"))
    .forEach((t) => t.id && chrome.tabs.reload(t.id).catch(() => {}));

const init = async () => {
  const { [CONFIG.STORAGE_KEY]: on = true } = await chrome.storage.local.get({ [CONFIG.STORAGE_KEY]: true });
  sync(on);
};

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.storage.onChanged.addListener(async (changes, ns) => {
  if (ns === "local" && CONFIG.STORAGE_KEY in changes) {
    sync(changes[CONFIG.STORAGE_KEY].newValue);
    await reloadTabs();
  }
});
