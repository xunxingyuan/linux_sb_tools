(function () {
  'use strict';

  const update = globalThis.LinuxSbUpdate;
  const ALARM = 'linux-sb-github-update-check';
  const PERIOD_MINUTES = 360;
  const PERIOD_MS = PERIOD_MINUTES * 60000;
  let activeCheck = null;

  async function readStatus() {
    const data = await chrome.storage.local.get(update.STORAGE_KEY);
    const localVersion = chrome.runtime.getManifest().version;
    const saved = data[update.STORAGE_KEY] || {};
    return {
      checkedAt: saved.checkedAt || '', lastAttemptAt: saved.lastAttemptAt || 0,
      remoteVersion: saved.remoteVersion || '', localVersion,
      available: saved.remoteVersion ? update.compareVersions(saved.remoteVersion, localVersion) > 0 : false,
      error: saved.error || ''
    };
  }

  async function showBadge(status) {
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    await chrome.action.setBadgeText({ text: status.available ? '1' : '' });
    await chrome.action.setTitle({ title: status.available ? `发现新版本 ${status.remoteVersion}` : 'LINUX SB 扩展工具箱' });
  }

  async function performCheck(force) {
    const cached = await readStatus();
    if (!force && Date.now() - cached.lastAttemptAt < PERIOD_MS) {
      await showBadge(cached);
      return cached;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(update.MANIFEST_URL, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
      const manifest = await response.json();
      const remoteVersion = String(manifest.version || '');
      const available = update.compareVersions(remoteVersion, cached.localVersion) > 0;
      const status = {
        checkedAt: new Date().toISOString(), lastAttemptAt: Date.now(),
        remoteVersion, localVersion: cached.localVersion, available, error: ''
      };
      await chrome.storage.local.set({ [update.STORAGE_KEY]: status });
      await showBadge(status);
      return status;
    } catch (error) {
      const status = { ...cached, lastAttemptAt: Date.now(), error: error.name === 'AbortError' ? '连接 GitHub 超时' : error.message };
      await chrome.storage.local.set({ [update.STORAGE_KEY]: status });
      await showBadge(status);
      return status;
    } finally {
      clearTimeout(timeout);
    }
  }

  function check(force = false) {
    if (!activeCheck) activeCheck = performCheck(force).finally(() => { activeCheck = null; });
    return activeCheck;
  }

  async function ensureAlarm() {
    const existing = await chrome.alarms.get(ALARM);
    if (!existing || existing.periodInMinutes !== PERIOD_MINUTES) {
      await chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!['UPDATE_GET', 'UPDATE_CHECK'].includes(message?.type)) return undefined;
    check(message.type === 'UPDATE_CHECK')
      .then((status) => respond({ ok: true, status }), (error) => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) check().catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => { ensureAlarm().then(() => check()).catch(() => {}); });
  ensureAlarm().then(() => check()).catch(() => {});
})();
