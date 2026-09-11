(function () {
  'use strict';
  const store = globalThis.LinuxSbState;
  const $ = id => document.getElementById(id);
  let currentState = null;
  const formatNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  function setStatus(text, error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', error);
  }
  function render(state) {
    currentState = state;
    const current = state.current;
    const summary = globalThis.LinuxSbTitleStats.summarizeHistory(state.historyRows);
    $('points').textContent = formatNumber(current.points);
    $('collection').textContent = `${current.ownedTypes ?? '—'}/${current.totalTypes ?? '—'}`;
    $('pulls').textContent = `${formatNumber(summary.totalPulls)} 次`;
    $('spend').textContent = `${formatNumber(summary.totalSpend)} 分`;
    $('adRemovalEnabled').checked = state.settings.adRemovalEnabled === true;
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
  $('adRemovalEnabled').addEventListener('change', async () => {
    const input = $('adRemovalEnabled');
    input.disabled = true;
    try {
      await store.request('SETTINGS', { patch: { adRemovalEnabled: input.checked } });
      setStatus('设置已保存');
    } catch (error) { input.checked = currentState?.settings.adRemovalEnabled === true; setStatus(error.message, true); }
    finally { input.disabled = false; }
  });
  $('refresh').addEventListener('click', refresh);
  for (const [id, path] of [['openGacha', '/gacha'], ['openProfile', '/gacha_profile'], ['openForge', '/gacha_forge_center']]) {
    $(id).addEventListener('click', () => { chrome.tabs.create({ url: `https://linux.sb${path}` }); window.close(); });
  }
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[store.STORAGE_KEY] && currentState) {
      const next = store.snapshot(store.normalize(changes[store.STORAGE_KEY].newValue), currentState.userId);
      $('adRemovalEnabled').checked = next.settings.adRemovalEnabled === true;
      currentState = next;
    }
  });
  store.request('GET').then(render).catch(error => setStatus(error.message, true));
})();
