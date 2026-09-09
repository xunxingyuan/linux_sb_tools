(function () {
  'use strict';

  if (location.hostname !== 'linux.sb') return;

  const STORAGE_KEY = 'linuxSbTitleAssistantState';

  function apply(enabled) {
    document.documentElement.classList.toggle('linux-sb-ad-removal-enabled', enabled === true);
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY]?.settings || {};
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    apply(changes[STORAGE_KEY].newValue?.settings?.adRemovalEnabled === true);
  });

  loadSettings()
    .then((settings) => apply(settings.adRemovalEnabled === true))
    .catch(() => apply(false));
})();
