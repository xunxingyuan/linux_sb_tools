(function () {
  'use strict';
  const store = globalThis.LinuxSbState;
  const $ = id => document.getElementById(id);
  const formatNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  const REPOSITORY_URL = 'https://github.com/xunxingyuan/linux_sb_tools';
  function renderUpdate(status, manual = false) {
    $('updateNotice').hidden = !status.available;
    if (status.available) {
      $('updateTitle').textContent = `GitHub 已发布 ${status.remoteVersion}`;
      $('updateDetail').textContent = `当前为 ${status.localVersion}。请先从 GitHub 获取新版并替换本地扩展文件，然后重新加载。`;
    }
    if (manual) {
      $('updateMessage').textContent = status.error ? `检查失败：${status.error}`
        : status.available ? `发现新版本 ${status.remoteVersion}` : `当前 ${status.localVersion} 已是最新版本`;
    }
  }

  async function checkUpdate(type, manual = false) {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) throw new Error(response?.error || '检查更新失败');
    renderUpdate(response.status, manual);
  }
  function renderMarket({ config, runtime }) {
    const rules = config.rules || [];
    const badge = $('marketBadge');
    const hasError = config.enabled && Boolean(runtime.lastError);
    badge.textContent = !rules.length ? '未设置' : hasError ? '检查异常' : config.enabled ? '监控中' : '已暂停';
    badge.classList.toggle('is-error', hasError);
    badge.classList.toggle('is-idle', !config.enabled || !rules.length);
    $('marketSummary').textContent = hasError ? runtime.lastError
      : !rules.length ? '添加称号和目标单价后，可开启价格提醒。'
      : !config.enabled ? `已保存 ${rules.length} 条规则 · 启用后每 ${config.intervalMinutes} 分钟检查`
      : `每 ${config.intervalMinutes} 分钟检查 · 最近命中 ${(runtime.matches || []).length} 条`;
    const matchedIds = new Set(config.enabled ? (runtime.matches || []).map(item => item.ruleId) : []);
    const list = $('marketRules');
    list.replaceChildren();
    for (const rule of rules) {
      const item = document.createElement('li');
      item.classList.toggle('is-match', matchedIds.has(rule.id));
      const title = document.createElement('span');
      title.className = 'rule-title';
      title.textContent = rule.title;
      const price = document.createElement('span');
      price.className = 'rule-price';
      price.textContent = `≤ ${formatNumber(rule.maxPrice)} 分`;
      item.append(title, price);
      list.append(item);
    }
    const checked = runtime.lastCheckedAt
      ? new Date(runtime.lastCheckedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    $('marketLastCheck').textContent = !rules.length ? '尚未检查'
      : checked ? `上次检查 ${checked}${runtime.accountId ? ` · 账号 ${runtime.accountId}` : ''}` : '尚未检查';
  }

  async function loadMarket() {
    const response = await chrome.runtime.sendMessage({ type: 'MARKET_GET' });
    if (!response?.ok) throw new Error(response?.error || '读取监控状态失败');
    renderMarket(response.result);
  }
  function setStatus(text, error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', error);
  }
  function render(state) {
    const current = state.current;
    const summary = globalThis.LinuxSbTitleStats.summarizeHistory(state.historyRows);
    $('points').textContent = formatNumber(current.points);
    $('collection').textContent = `${current.ownedTypes ?? '—'}/${current.totalTypes ?? '—'}`;
    $('pulls').textContent = `${formatNumber(summary.totalPulls)} 次`;
    $('spend').textContent = `${formatNumber(summary.totalSpend)} 分`;
    const updated = state.updatedAt
      ? new Date(state.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    setStatus(updated ? `账号 ${state.userId} · ${updated} 更新` : '打开称号页以同步');
  }
  async function refresh() {
    $('refresh').disabled = true;
    setStatus('正在更新数据…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('请先打开称号抽取或熔铸页面');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_DATA' });
      if (!response?.ok) throw new Error(response?.error || '请先打开称号抽取或熔铸页面');
      render(response.state);
      setStatus('数据已更新');
    } catch (error) {
      setStatus(/Receiving end does not exist|Could not establish connection/.test(error.message) ? '请先打开称号抽取或熔铸页面' : error.message, true);
    } finally { $('refresh').disabled = false; }
  }
  $('refresh').addEventListener('click', refresh);
  for (const [id, path] of [['openGacha', '/gacha'], ['openProfile', '/gacha_profile'], ['openForge', '/gacha_forge_center'], ['openMarket', '/gacha_market']]) {
    $(id).addEventListener('click', () => { chrome.tabs.create({ url: `https://linux.sb${path}` }); window.close(); });
  }
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('manageMarket').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('openUpdate').addEventListener('click', () => { chrome.tabs.create({ url: REPOSITORY_URL }); window.close(); });
  $('reloadUpdatedFiles').addEventListener('click', () => chrome.runtime.reload());
  $('checkUpdate').addEventListener('click', async () => {
    const button = $('checkUpdate');
    button.disabled = true;
    $('updateMessage').textContent = '正在检查 GitHub…';
    try { await checkUpdate('UPDATE_CHECK', true); }
    catch (error) { $('updateMessage').textContent = `检查失败：${error.message}`; }
    finally { button.disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.linuxSbMarketWatchConfig || changes.linuxSbMarketWatchRuntime)) {
      loadMarket().catch(() => { $('marketSummary').textContent = '读取监控状态失败'; });
    }
    if (area === 'local' && changes.linuxSbUpdateStatus) {
      const status = changes.linuxSbUpdateStatus.newValue;
      if (status) renderUpdate(status);
    }
  });
  store.request('GET').then(render).catch(error => setStatus(error.message, true));
  checkUpdate('UPDATE_GET').catch(() => {});
  loadMarket().catch(() => {
    $('marketBadge').textContent = '读取失败';
    $('marketBadge').classList.add('is-error');
    $('marketSummary').textContent = '请重新打开弹窗或检查扩展状态。';
  });
})();
