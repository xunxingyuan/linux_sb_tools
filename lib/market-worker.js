(function () {
  'use strict';

  const market = globalThis.LinuxSbMarket;
  const ALARM = 'linux-sb-market-watch';
  let activeScan = null;
  let creatingOffscreen = null;

  async function read() {
    const data = await chrome.storage.local.get([market.CONFIG_KEY, market.RUNTIME_KEY]);
    return {
      config: market.normalizeConfig(data[market.CONFIG_KEY]),
      runtime: { accountId: '', lastCheckedAt: '', lastError: '', matches: [], notified: {}, links: {}, ...data[market.RUNTIME_KEY] }
    };
  }

  async function setAlarm(config) {
    if (config.enabled && config.rules.length) {
      const existing = await chrome.alarms.get(ALARM);
      if (!existing || existing.periodInMinutes !== config.intervalMinutes) {
        await chrome.alarms.create(ALARM, { periodInMinutes: config.intervalMinutes });
      }
    } else {
      await chrome.alarms.clear(ALARM);
    }
  }

  function validateConfig(input, current) {
    const rules = Array.isArray(input.rules) ? input.rules : [];
    if (rules.length > 10) throw new Error('最多监控 10 种称号');
    const titles = new Set();
    const normalized = rules.map((rule) => {
      const title = market.normalizeTitle(rule.title);
      const maxPrice = Number(rule.maxPrice);
      if (!title || title.length > 80) throw new Error('请输入 1～80 字的称号名称');
      if (!Number.isSafeInteger(maxPrice) || maxPrice < 1 || maxPrice > 1000000000) throw new Error('目标单价应为 1～10 亿积分的整数');
      if (titles.has(title)) throw new Error('同一个称号只需设置一条价格规则');
      titles.add(title);
      const previous = current.rules.find((item) => item.id === rule.id);
      return { id: previous ? previous.id : crypto.randomUUID(), title, maxPrice };
    });
    const intervalMinutes = Number(input.intervalMinutes);
    if (!market.INTERVALS.includes(intervalMinutes)) throw new Error('请选择有效的检查间隔');
    if (input.enabled && !normalized.length) throw new Error('请先添加至少一种称号');
    return { enabled: input.enabled === true, intervalMinutes, rules: normalized };
  }

  async function ensureOffscreen() {
    const url = chrome.runtime.getURL('market-offscreen.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (contexts.length) return;
    if (!creatingOffscreen) {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: 'market-offscreen.html', reasons: ['DOM_PARSER'],
        justification: 'Read and parse title market listings for user-configured price alerts'
      }).finally(() => { creatingOffscreen = null; });
    }
    await creatingOffscreen;
  }

  async function sendScan(rules) {
    await ensureOffscreen();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'MARKET_SCAN', target: 'offscreen', rules });
      if (!response?.ok) throw new Error(response?.error || '市场扫描失败');
      return response;
    } finally {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  }

  async function performScan() {
    const { config, runtime } = await read();
    if (!config.rules.length) throw new Error('请先添加监控规则');
    try {
      const response = await sendScan(config.rules);
      if (runtime.accountId && runtime.accountId !== response.accountId) throw new Error('登录账号已变化；请关闭再开启监控以绑定当前账号');
      runtime.accountId = response.accountId;
      runtime.lastCheckedAt = new Date().toISOString();
      runtime.lastError = '';
      runtime.matches = response.matches;
      const now = Date.now();
      runtime.notified = Object.fromEntries(Object.entries(runtime.notified).filter(([, time]) => now - time < 7 * 86400000).slice(-500));
      runtime.links = Object.fromEntries(Object.entries(runtime.links).filter(([id]) => id in runtime.notified));
      if (config.enabled && response.matches.length && await chrome.notifications.getPermissionLevel() !== 'granted') {
        throw new Error('桌面通知已被关闭，请在浏览器或系统设置中开启扩展通知');
      }
      for (const listing of response.matches) {
        if (!config.enabled) break;
        const key = `${listing.ruleId}:${listing.id}:${listing.price}`;
        if (runtime.notified[key]) continue;
        const notificationId = `market-${key}`;
        runtime.links[notificationId] = market.searchUrl(listing.title);
        await chrome.storage.local.set({ [market.RUNTIME_KEY]: runtime });
        try {
          await chrome.notifications.create(notificationId, {
            type: 'basic', iconUrl: 'icons/market.png', title: '称号价格提醒',
            message: `${listing.title}：${listing.price.toLocaleString('zh-CN')} 积分，符合你的目标价。点击查看并自行确认购买。`
          });
          runtime.notified[key] = now;
        } catch (error) {
          delete runtime.links[notificationId];
          throw error;
        }
      }
      await chrome.storage.local.set({ [market.RUNTIME_KEY]: runtime });
      return runtime;
    } catch (error) {
      runtime.lastError = error.message || '市场检查失败';
      await chrome.storage.local.set({ [market.RUNTIME_KEY]: runtime });
      throw error;
    }
  }

  function scan() {
    if (!activeScan) activeScan = performScan().finally(() => { activeScan = null; });
    return activeScan;
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!message || !['MARKET_GET', 'MARKET_SAVE', 'MARKET_CHECK'].includes(message.type)) return undefined;
    (async () => {
      if (message.type === 'MARKET_GET') return read();
      if (message.type === 'MARKET_CHECK') return { runtime: await scan() };
      const { config: oldConfig, runtime } = await read();
      const config = validateConfig(message.config || {}, oldConfig);
      if (!oldConfig.enabled && config.enabled) {
        runtime.accountId = '';
        runtime.lastError = '';
      }
      if (!config.enabled) runtime.lastError = '';
      const unchanged = JSON.stringify(oldConfig.rules) === JSON.stringify(config.rules);
      if (!unchanged) { runtime.notified = {}; runtime.links = {}; runtime.matches = []; }
      await chrome.storage.local.set({ [market.CONFIG_KEY]: config, [market.RUNTIME_KEY]: runtime });
      await setAlarm(config);
      return { config, runtime };
    })().then((result) => respond({ ok: true, result }), (error) => respond({ ok: false, error: error.message }));
    return true;
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) scan().catch(() => {});
  });
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    const { runtime } = await read();
    const url = runtime.links[notificationId];
    if (!url) return;
    const tabs = await chrome.tabs.query({ url: `${market.MARKET_URL}*` });
    const tab = tabs.find((item) => {
      try { return new URL(item.url).pathname === '/gacha_market'; } catch (_error) { return false; }
    });
    const target = tab ? await chrome.tabs.update(tab.id, { url, active: true }) : await chrome.tabs.create({ url, active: true });
    if (target.windowId) await chrome.windows.update(target.windowId, { focused: true });
    await chrome.notifications.clear(notificationId);
  });
  chrome.runtime.onStartup.addListener(() => { read().then(({ config }) => setAlarm(config)).catch(() => {}); });
  read().then(({ config }) => setAlarm(config)).catch(() => {});
})();
