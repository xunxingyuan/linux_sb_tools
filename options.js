(function () {
  'use strict';

  const store = globalThis.LinuxSbState;
  let displayedUserId = '';
  let displayedSettings = {};

  const form = document.getElementById('settingsForm');
  const reserve = document.getElementById('reservePoints');
  const confirmEachDraw = document.getElementById('confirmEachDraw');
  const message = document.getElementById('message');
  const marketForm = document.getElementById('marketWatchForm');
  const marketRules = document.getElementById('marketRules');
  const marketMessage = document.getElementById('marketMessage');

  async function marketRequest(type, config) {
    const response = await chrome.runtime.sendMessage({ type, config });
    if (!response?.ok) throw new Error(response?.error || '市场监控操作失败');
    return response.result;
  }

  function addRule(rule = {}) {
    const row = document.createElement('div');
    row.className = 'market-rule';
    row.dataset.ruleId = rule.id || '';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = '称号名称';
    const title = document.createElement('input');
    title.type = 'text'; title.className = 'market-title'; title.maxLength = 80;
    title.placeholder = '例如：反贼'; title.value = rule.title || '';
    titleLabel.append(title);
    const priceLabel = document.createElement('label');
    priceLabel.textContent = '最高单价（积分）';
    const price = document.createElement('input');
    price.type = 'number'; price.className = 'market-price'; price.min = '1'; price.max = '1000000000'; price.step = '1';
    price.value = rule.maxPrice || '';
    priceLabel.append(price);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'market-remove'; remove.textContent = '移除';
    remove.addEventListener('click', () => row.remove());
    row.append(titleLabel, priceLabel, remove);
    marketRules.append(row);
  }

  function showMarketStatus(runtime) {
    const checked = runtime.lastCheckedAt ? new Date(runtime.lastCheckedAt).toLocaleString('zh-CN') : '尚未检查';
    const matched = Array.isArray(runtime.matches) ? runtime.matches.length : 0;
    document.getElementById('marketStatus').textContent = `上次检查：${checked} · 最近命中 ${matched} 条${runtime.accountId ? ` · 账号 ${runtime.accountId}` : ''}`;
    if (runtime.lastError) marketMessage.textContent = `检查失败：${runtime.lastError}`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const values = {
        reservePoints: Math.max(0, Number(reserve.value) || 0),
        confirmEachDraw: confirmEachDraw.checked
      };
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== displayedSettings[key]));
      const saved = await store.request('SETTINGS', { patch });
      displayedSettings = { ...saved.settings };
      reserve.value = String(saved.settings.reservePoints);
      confirmEachDraw.checked = saved.settings.confirmEachDraw;
      message.textContent = '设置已保存。';
    } catch (error) { message.textContent = error.message; }
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    try {
      await store.request('CLEAR_HISTORY', { userId: displayedUserId });
      message.textContent = `账号 ${displayedUserId} 的本地历史已清除；库存和积分快照保留。`;
    } catch (error) { message.textContent = error.message; }
  });

  store.request('GET').then((state) => {
    displayedSettings = { ...state.settings };
    reserve.value = String(state.settings.reservePoints || 0);
    confirmEachDraw.checked = state.settings.confirmEachDraw !== false;
    displayedUserId = state.userId;
    document.getElementById('clearHistory').disabled = !state.userId;
    document.getElementById('accountLabel').textContent = state.userId ? `当前统计账号：${state.userId}` : '请先在称号页面确认账号';
  }).catch(() => {
    message.textContent = '读取设置失败。';
  });

  document.getElementById('addMarketRule').addEventListener('click', () => {
    if (marketRules.children.length >= 10) { marketMessage.textContent = '最多监控 10 种称号。'; return; }
    addRule();
  });

  marketForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    marketMessage.textContent = '正在保存…';
    try {
      const config = {
        enabled: document.getElementById('marketEnabled').checked,
        intervalMinutes: Number(document.getElementById('marketInterval').value),
        rules: [...marketRules.children].filter((row) => row.querySelector('.market-title').value.trim() || row.querySelector('.market-price').value).map((row) => ({
          id: row.dataset.ruleId,
          title: row.querySelector('.market-title').value,
          maxPrice: Number(row.querySelector('.market-price').value)
        }))
      };
      const saved = await marketRequest('MARKET_SAVE', config);
      marketRules.replaceChildren();
      saved.config.rules.forEach(addRule);
      marketMessage.textContent = saved.config.enabled ? '监控已保存，正在首次检查…' : '监控已关闭。';
      showMarketStatus(saved.runtime);
      if (saved.config.enabled) {
        const checked = await marketRequest('MARKET_CHECK');
        showMarketStatus(checked.runtime);
        marketMessage.textContent = `检查完成，命中 ${checked.runtime.matches.length} 条。`;
      }
    } catch (error) { marketMessage.textContent = error.message; }
  });

  document.getElementById('marketCheckNow').addEventListener('click', async () => {
    marketMessage.textContent = '正在检查市场…';
    try {
      const checked = await marketRequest('MARKET_CHECK');
      showMarketStatus(checked.runtime);
      marketMessage.textContent = `检查完成，命中 ${checked.runtime.matches.length} 条。`;
    } catch (error) { marketMessage.textContent = error.message; }
  });

  marketRequest('MARKET_GET').then(({ config, runtime }) => {
    document.getElementById('marketEnabled').checked = config.enabled;
    document.getElementById('marketInterval').value = String(config.intervalMinutes);
    config.rules.forEach(addRule);
    if (!config.rules.length) addRule();
    showMarketStatus(runtime);
  }).catch((error) => { marketMessage.textContent = error.message; });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.linuxSbMarketWatchRuntime) showMarketStatus(changes.linuxSbMarketWatchRuntime.newValue);
  });
})();
