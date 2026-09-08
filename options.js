(function () {
  'use strict';

  const STORAGE_KEY = 'linuxSbTitleAssistantState';
  const IMAGE_CONFIG_KEY = 'linuxSbImageHostConfig';
  const DEFAULT_STATE = {
    version: 1,
    updatedAt: '',
    userId: '',
    current: { points: null, pool: [], titles: [], inventory: [], ownedTypes: null, totalTypes: null },
    historyRows: [],
    forgeEvents: [],
    settings: { reservePoints: 0, confirmEachDraw: true },
    pendingDraw: null
  };

  const form = document.getElementById('settingsForm');
  const reserve = document.getElementById('reservePoints');
  const confirmEachDraw = document.getElementById('confirmEachDraw');
  const message = document.getElementById('message');
  const imageHostForm = document.getElementById('imageHostForm');
  const imageHostEnabled = document.getElementById('imageHostEnabled');
  const imageProvider = document.getElementById('imageProvider');
  const cloudflareAccountId = document.getElementById('cloudflareAccountId');
  const cloudflareBucket = document.getElementById('cloudflareBucket');
  const cloudflareAccessKeyId = document.getElementById('cloudflareAccessKeyId');
  const cloudflareSecretAccessKey = document.getElementById('cloudflareSecretAccessKey');
  const cloudflarePublicBaseUrl = document.getElementById('cloudflarePublicBaseUrl');
  const cloudflareObjectPrefix = document.getElementById('cloudflareObjectPrefix');
  const imageCompressionEnabled = document.getElementById('imageCompressionEnabled');
  const imageCompressionQuality = document.getElementById('imageCompressionQuality');
  const imageMaxDimension = document.getElementById('imageMaxDimension');
  const imageHostMessage = document.getElementById('imageHostMessage');

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function mergedState(saved) {
    return {
      ...DEFAULT_STATE,
      ...(saved || {}),
      current: { ...DEFAULT_STATE.current, ...((saved && saved.current) || {}) },
      settings: { ...DEFAULT_STATE.settings, ...((saved && saved.settings) || {}) }
    };
  }

  async function readState() {
    const value = await chrome.storage.local.get(STORAGE_KEY);
    return mergedState(value[STORAGE_KEY]);
  }

  async function writeState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function readImageConfig() {
    const value = await chrome.storage.local.get(IMAGE_CONFIG_KEY);
    return {
      enabled: false,
      provider: 'cloudflare-r2',
      accountId: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      publicBaseUrl: '',
      objectPrefix: 'linux-sb',
      compressionEnabled: true,
      compressionQuality: 0.84,
      maxDimension: 2560,
      ...(value[IMAGE_CONFIG_KEY] || {})
    };
  }

  async function writeImageConfig(config) {
    await chrome.storage.local.set({ [IMAGE_CONFIG_KEY]: config });
  }

  function collectImageConfig(currentConfig) {
    return {
      ...currentConfig,
      enabled: imageHostEnabled.checked,
      provider: 'cloudflare-r2',
      accountId: cloudflareAccountId.value.trim(),
      bucket: cloudflareBucket.value.trim(),
      accessKeyId: cloudflareAccessKeyId.value.trim(),
      secretAccessKey: cloudflareSecretAccessKey.value.trim() || currentConfig.secretAccessKey || '',
      publicBaseUrl: cloudflarePublicBaseUrl.value.trim(),
      objectPrefix: cloudflareObjectPrefix.value.trim() || 'linux-sb',
      compressionEnabled: imageCompressionEnabled.checked,
      compressionQuality: clamp(imageCompressionQuality.value, 0.5, 0.95, 0.84),
      maxDimension: Math.round(clamp(imageMaxDimension.value, 512, 8192, 2560))
    };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const state = await readState();
    state.settings = {
      ...state.settings,
      reservePoints: Math.max(0, Number(reserve.value) || 0),
      confirmEachDraw: confirmEachDraw.checked
    };
    await writeState(state);
    message.textContent = '设置已保存。';
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    const state = await readState();
    state.historyRows = [];
    state.forgeEvents = [];
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    message.textContent = '本地历史统计已清除；当前库存和积分快照保留。';
  });

  imageHostForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentConfig = await readImageConfig();
    await writeImageConfig(collectImageConfig(currentConfig));
    imageHostMessage.textContent = imageHostEnabled.checked ? '图床助手已启用。刷新发帖页后生效。' : '图床助手已关闭。';
  });

  document.getElementById('disableImageHost').addEventListener('click', async () => {
    imageHostEnabled.checked = false;
    const currentConfig = await readImageConfig();
    await writeImageConfig({ ...collectImageConfig(currentConfig), enabled: false });
    imageHostMessage.textContent = '图床助手已关闭。';
  });

  document.getElementById('clearImageCredentials').addEventListener('click', async () => {
    imageHostEnabled.checked = false;
    cloudflareAccountId.value = '';
    cloudflareBucket.value = '';
    cloudflareAccessKeyId.value = '';
    cloudflareSecretAccessKey.value = '';
    cloudflarePublicBaseUrl.value = '';
    cloudflareObjectPrefix.value = 'linux-sb';
    imageCompressionEnabled.checked = true;
    imageCompressionQuality.value = '0.84';
    imageMaxDimension.value = '2560';
    await writeImageConfig({
      enabled: false,
      provider: 'cloudflare-r2',
      accountId: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      publicBaseUrl: '',
      objectPrefix: 'linux-sb',
      compressionEnabled: true,
      compressionQuality: 0.84,
      maxDimension: 2560
    });
    imageHostMessage.textContent = 'Cloudflare R2 凭据已清除，图床助手已关闭。';
  });

  Promise.all([readState(), readImageConfig()]).then(([state, imageConfig]) => {
    reserve.value = String(state.settings.reservePoints || 0);
    confirmEachDraw.checked = state.settings.confirmEachDraw !== false;
    imageHostEnabled.checked = imageConfig.enabled === true;
    imageProvider.value = 'cloudflare-r2';
    cloudflareAccountId.value = imageConfig.accountId || '';
    cloudflareBucket.value = imageConfig.bucket || '';
    cloudflareAccessKeyId.value = imageConfig.accessKeyId || '';
    cloudflareSecretAccessKey.value = imageConfig.secretAccessKey || '';
    cloudflarePublicBaseUrl.value = imageConfig.publicBaseUrl || '';
    cloudflareObjectPrefix.value = imageConfig.objectPrefix || 'linux-sb';
    imageCompressionEnabled.checked = imageConfig.compressionEnabled !== false;
    imageCompressionQuality.value = String(clamp(imageConfig.compressionQuality, 0.5, 0.95, 0.84));
    imageMaxDimension.value = String(Math.round(clamp(imageConfig.maxDimension, 512, 8192, 2560)));
  }).catch(() => {
    message.textContent = '读取设置失败。';
  });
})();
