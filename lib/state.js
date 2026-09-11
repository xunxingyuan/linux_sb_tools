(function (global) {
  'use strict';
  const STORAGE_KEY = 'linuxSbTitleAssistantState';
  const IMAGE_CONFIG_KEY = 'linuxSbImageHostConfig';
  const DEFAULT_SETTINGS = {
    reservePoints: 0, confirmEachDraw: true, adRemovalEnabled: false,
    forgeExcludedNames: ['路人甲', '反贼'], forgeKeepOne: true, forgeTarget: 'SR'
  };
  const DEFAULT_IMAGE_CONFIG = {
    enabled: false, provider: 'cloudflare-r2', accountId: '', bucket: '',
    accessKeyId: '', secretAccessKey: '', publicBaseUrl: '', objectPrefix: 'linux-sb',
    compressionEnabled: true, compressionQuality: 0.84, maxDimension: 2560
  };
  function imageSettings(config = DEFAULT_IMAGE_CONFIG) {
    const quality = Number(config.compressionQuality ?? DEFAULT_IMAGE_CONFIG.compressionQuality);
    const dimension = Number(config.maxDimension ?? DEFAULT_IMAGE_CONFIG.maxDimension);
    return {
      enabled: config.enabled === true, provider: config.provider || 'cloudflare-r2',
      compressionEnabled: config.compressionEnabled !== false,
      compressionQuality: Number.isFinite(quality) ? Math.max(0.5, Math.min(0.95, quality)) : 0.84,
      maxDimension: Number.isFinite(dimension) ? Math.round(Math.max(512, Math.min(8192, dimension))) : 2560
    };
  }
  function emptyAccount() {
    return {
      updatedAt: '', current: { points: null, pool: [], titles: [], inventory: [], ownedTypes: null, totalTypes: null },
      historyRows: [], forgeEvents: [], sync: {}, historyGeneration: 0, pendingForge: null
    };
  }
  function normalize(saved = {}) {
    const settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    settings.forgeExcludedNames = Array.isArray(settings.forgeExcludedNames)
      ? [...settings.forgeExcludedNames] : [...DEFAULT_SETTINGS.forgeExcludedNames];
    if (saved.version === 2) return { ...saved, settings, accounts: { ...saved.accounts } };
    const root = { version: 2, settings, accounts: {}, activeUserId: '' };
    if (/^\d+$/.test(saved.userId || '')) {
      root.activeUserId = saved.userId;
      root.accounts[saved.userId] = {
        ...emptyAccount(), updatedAt: saved.updatedAt || '',
        current: { ...emptyAccount().current, ...saved.current },
        historyRows: Array.isArray(saved.historyRows) ? saved.historyRows : [],
        forgeEvents: Array.isArray(saved.forgeEvents) ? saved.forgeEvents : []
      };
    } else if (saved.current || saved.historyRows || saved.forgeEvents) {
      // Unidentified legacy data is preserved, never assigned to a guessed account.
      root.unassignedLegacy = saved;
    }
    return root;
  }
  function snapshot(root, userId = root.activeUserId || '') {
    const account = root.accounts[userId] || emptyAccount();
    return { ...emptyAccount(), ...account, userId, settings: { ...root.settings } };
  }
  function recordKey(row) {
    return row.id ? `id:${row.id}` : JSON.stringify([row.time, row.text || row.reason, row.change]);
  }
  function mergeRecords(existing, incoming) {
    const result = [...existing];
    const counts = new Map();
    for (const row of existing) counts.set(recordKey(row), (counts.get(recordKey(row)) || 0) + 1);
    const byId = new Map(existing.flatMap((row, index) => row.id ? [[row.id, index]] : []));
    const seen = new Map();
    for (const row of incoming) {
      if (row.id) {
        if (byId.has(row.id)) { result[byId.get(row.id)] = row; continue; }
        const legacyKey = recordKey({ ...row, id: '' });
        const legacy = result.findIndex(item => !item.id && recordKey(item) === legacyKey);
        const index = legacy < 0 ? result.length : legacy;
        result[index] = row;
        byId.set(row.id, index);
        continue;
      }
      const key = recordKey(row);
      seen.set(key, (seen.get(key) || 0) + 1);
      if (seen.get(key) > (counts.get(key) || 0)) result.push(row);
    }
    return result.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }
  async function request(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'STATE', action, ...payload });
    if (!response?.ok) throw new Error(response?.error || '操作失败，请刷新页面后重试');
    return response.result;
  }
  const api = { STORAGE_KEY, IMAGE_CONFIG_KEY, DEFAULT_SETTINGS, DEFAULT_IMAGE_CONFIG, imageSettings, emptyAccount, normalize, snapshot, recordKey, mergeRecords, request };
  global.LinuxSbState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
