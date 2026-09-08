(function () {
  'use strict';

  const STORAGE_KEY = 'linuxSbTitleAssistantState';
  const DEFAULT_SETTINGS = { reservePoints: 0, confirmEachDraw: true };

  function emptyState() {
    return {
      current: {},
      historyRows: [],
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  const $ = (id) => document.getElementById(id);

  function formatNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  }

  function setStatus(text, isError) {
    const node = $('status');
    node.textContent = text;
    node.classList.toggle('error', Boolean(isError));
  }

  function summarize(state) {
    const history = Array.isArray(state && state.historyRows) ? state.historyRows : [];
    const result = {
      pulls: 0,
      spend: 0,
      byMode: { single: 0, ten: 0, hundred: 0 }
    };
    history.forEach((row) => {
      if (row.kind !== 'draw') return;
      result.pulls += Number(row.pulls || 0);
      result.spend += Math.abs(Number(row.change || 0));
      if (result.byMode[row.mode] !== undefined) result.byMode[row.mode] += 1;
    });
    return result;
  }

  function render(state) {
    const current = state && state.current ? state.current : {};
    const summary = summarize(state || {});
    const owned = Number.isFinite(Number(current.ownedTypes)) ? current.ownedTypes : (current.inventory || []).length;
    const total = current.totalTypes || (current.titles || []).length || '—';
    $('points').textContent = formatNumber(current.points);
    $('collection').textContent = `${owned}/${total}`;
    $('pulls').textContent = `${formatNumber(summary.pulls)} 次`;
    $('spend').textContent = `${formatNumber(summary.spend)} 分`;
    const updated = state && state.updatedAt ? new Date(state.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    setStatus(updated ? `上次更新：${updated}` : '尚未同步积分流水');
    const settings = { ...DEFAULT_SETTINGS, ...((state && state.settings) || {}) };
    $('reserve').value = String(settings.reservePoints || 0);
    $('confirmEachDraw').checked = settings.confirmEachDraw !== false;
  }

  async function getState() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const saved = data[STORAGE_KEY] || {};
    return {
      ...emptyState(),
      ...saved,
      current: { ...emptyState().current, ...(saved.current || {}) },
      historyRows: Array.isArray(saved.historyRows) ? saved.historyRows : [],
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) }
    };
  }

  async function saveSettings() {
    const state = await getState();
    state.settings = {
      reservePoints: Math.max(0, Number($('reserve').value) || 0),
      confirmEachDraw: $('confirmEachDraw').checked
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    render(state);
  }

  async function sendToCurrentTab(type) {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) throw new Error('没有找到当前页面');
    return chrome.tabs.sendMessage(tab.id, { type });
  }

  async function refresh(type, label) {
    $('refresh').disabled = true;
    $('sync').disabled = true;
    setStatus(`${label}…`);
    try {
      const response = await sendToCurrentTab(type);
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : '当前页面不是可识别的 LINUX SB 页面');
      render(response.state);
      setStatus(`${label}完成`);
    } catch (error) {
      const message = error && error.message ? error.message : '';
      const friendly = /Receiving end does not exist|Could not establish connection|没有找到当前页面/.test(message)
        ? '当前页面不注入统计模块；图床助手仅在发帖或回帖页、且启用后显示。'
        : (message || `${label}失败`);
      setStatus(friendly, true);
    } finally {
      $('refresh').disabled = false;
      $('sync').disabled = false;
    }
  }

  function openPage(path) {
    chrome.tabs.create({ url: `https://linux.sb${path}` });
    window.close();
  }

  function bindEvents() {
    $('reserve').addEventListener('change', saveSettings);
    $('confirmEachDraw').addEventListener('change', saveSettings);
    $('refresh').addEventListener('click', () => refresh('REFRESH', '刷新页面数据'));
    $('sync').addEventListener('click', () => refresh('SYNC_HISTORY', '同步积分流水'));
    $('openGacha').addEventListener('click', () => openPage('/gacha'));
    $('openProfile').addEventListener('click', () => openPage('/gacha_profile'));
    $('openForge').addEventListener('click', () => openPage('/gacha_forge_center'));
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  }

  (async function init() {
    bindEvents();
    render(emptyState());
    try {
      render(await getState());
    } catch (error) {
      setStatus(error.message || '本地统计尚未初始化', true);
    }
  })().catch((error) => setStatus(error.message || '读取失败', true));
})();
