(function () {
  'use strict';

  const store = globalThis.LinuxSbState;
  const IMAGE_CONFIG_KEY = store.IMAGE_CONFIG_KEY;
  let displayedUserId = '';
  let displayedSettings = {};

  const form = document.getElementById('settingsForm');
  const reserve = document.getElementById('reservePoints');
  const confirmEachDraw = document.getElementById('confirmEachDraw');
  const adRemovalEnabled = document.getElementById('adRemovalEnabled');
  const message = document.getElementById('message');
  const imageHostForm = document.getElementById('imageHostForm');
  const imageHostEnabled = document.getElementById('imageHostEnabled');
  const imagePreset = document.getElementById('imagePreset');
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

  async function readState() { return store.request('GET'); }

  async function readImageConfig() {
    const value = await chrome.storage.local.get(IMAGE_CONFIG_KEY);
    return { ...store.DEFAULT_IMAGE_CONFIG, ...value[IMAGE_CONFIG_KEY] };
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
    try {
      const values = {
        reservePoints: Math.max(0, Number(reserve.value) || 0),
        confirmEachDraw: confirmEachDraw.checked,
        adRemovalEnabled: adRemovalEnabled.checked
      };
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== displayedSettings[key]));
      const saved = await store.request('SETTINGS', { patch });
      displayedSettings = { ...saved.settings };
      reserve.value = String(saved.settings.reservePoints);
      confirmEachDraw.checked = saved.settings.confirmEachDraw;
      adRemovalEnabled.checked = saved.settings.adRemovalEnabled;
      message.textContent = '设置已保存。';
    } catch (error) { message.textContent = error.message; }
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    try {
      await store.request('CLEAR_HISTORY', { userId: displayedUserId });
      message.textContent = `账号 ${displayedUserId} 的本地历史已清除；库存和积分快照保留。`;
    } catch (error) { message.textContent = error.message; }
  });

  imageHostForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentConfig = await readImageConfig();
    try {
      const config = collectImageConfig(currentConfig);
      if (config.enabled) {
        if (![config.accountId, config.bucket, config.accessKeyId, config.secretAccessKey].every(Boolean)) throw new Error('请填写账户 ID、Bucket 和访问凭据');
        if (new URL(config.publicBaseUrl).protocol !== 'https:') throw new Error('公开访问地址需要使用 HTTPS');
      }
      await writeImageConfig(config);
      imageHostMessage.textContent = config.enabled ? '图床助手已启用。' : '图床助手已关闭。';
    } catch (error) { imageHostMessage.textContent = error.message; }
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
    imagePreset.value = 'recommended';
    await writeImageConfig({ ...store.DEFAULT_IMAGE_CONFIG });
    imageHostMessage.textContent = 'Cloudflare R2 凭据已清除，图床助手已关闭。';
  });

  function syncPreset() {
    imagePreset.value = !imageCompressionEnabled.checked ? 'original'
      : Number(imageCompressionQuality.value) === 0.84 && Number(imageMaxDimension.value) === 2560 ? 'recommended'
      : Number(imageCompressionQuality.value) === 0.9 && Number(imageMaxDimension.value) === 4096 ? 'high' : 'custom';
  }
  imagePreset.addEventListener('change', () => {
    const preset = imagePreset.value;
    if (preset === 'custom') { document.getElementById('imageAdvanced').open = true; return; }
    imageCompressionEnabled.checked = preset !== 'original';
    if (preset !== 'original') {
      imageCompressionQuality.value = preset === 'high' ? '0.9' : '0.84';
      imageMaxDimension.value = preset === 'high' ? '4096' : '2560';
    }
  });
  [imageCompressionEnabled, imageCompressionQuality, imageMaxDimension].forEach(input => input.addEventListener('change', syncPreset));

  Promise.all([readState(), readImageConfig()]).then(([state, imageConfig]) => {
    displayedSettings = { ...state.settings };
    reserve.value = String(state.settings.reservePoints || 0);
    confirmEachDraw.checked = state.settings.confirmEachDraw !== false;
    adRemovalEnabled.checked = state.settings.adRemovalEnabled === true;
    imageHostEnabled.checked = imageConfig.enabled === true;
    displayedUserId = state.userId;
    document.getElementById('clearHistory').disabled = !state.userId;
    document.getElementById('accountLabel').textContent = state.userId ? `当前统计账号：${state.userId}` : '请先在称号页面确认账号';
    cloudflareAccountId.value = imageConfig.accountId || '';
    cloudflareBucket.value = imageConfig.bucket || '';
    cloudflareAccessKeyId.value = imageConfig.accessKeyId || '';
    cloudflareSecretAccessKey.value = imageConfig.secretAccessKey || '';
    cloudflarePublicBaseUrl.value = imageConfig.publicBaseUrl || '';
    cloudflareObjectPrefix.value = imageConfig.objectPrefix || 'linux-sb';
    imageCompressionEnabled.checked = imageConfig.compressionEnabled !== false;
    imageCompressionQuality.value = String(clamp(imageConfig.compressionQuality, 0.5, 0.95, 0.84));
    imageMaxDimension.value = String(Math.round(clamp(imageConfig.maxDimension, 512, 8192, 2560)));
    syncPreset();
  }).catch(() => {
    message.textContent = '读取设置失败。';
  });
})();
