(function () {
  'use strict';

  const CONFIG_KEY = 'linuxSbImageHostConfig';
  const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
  const encoder = new TextEncoder();

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }

  async function hmacSha256(key, value) {
    const keyBytes = typeof key === 'string' ? encoder.encode(key) : key;
    const valueBytes = typeof value === 'string' ? encoder.encode(value) : value;
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, valueBytes));
  }

  function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  function encodePath(value) {
    return String(value).split('/').map(encodeRfc3986).join('/');
  }

  function randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  function safeFileName(value) {
    const cleaned = String(value || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
    return cleaned || 'image';
  }

  async function loadConfig() {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
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
      ...(stored[CONFIG_KEY] || {})
    };
  }

  function imageHostSettings(config) {
    const quality = Number(config.compressionQuality);
    const maxDimension = Number(config.maxDimension);
    return {
      enabled: config.enabled === true,
      provider: config.provider || 'cloudflare-r2',
      compressionEnabled: config.compressionEnabled !== false,
      compressionQuality: Number.isFinite(quality) ? Math.min(0.95, Math.max(0.5, quality)) : 0.84,
      maxDimension: Number.isFinite(maxDimension) ? Math.round(Math.min(8192, Math.max(512, maxDimension))) : 2560
    };
  }

  function validatePublicBaseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href.replace(/\/+$/, '') : '';
    } catch (_error) {
      return '';
    }
  }

  function createObjectKey(config, filename) {
    const prefix = String(config.objectPrefix || 'linux-sb').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._/-]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    return `${prefix || 'linux-sb'}/${date}/${Date.now()}-${randomHex(6)}-${safeFileName(filename)}`;
  }

  async function uploadR2Image(file) {
    const config = await loadConfig();
    if (!config.enabled) throw new Error('图床助手尚未启用');
    if (config.provider !== 'cloudflare-r2') throw new Error('暂不支持当前图床类型');
    if (!config.accountId || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('请先填写 Cloudflare R2 的账户 ID、Bucket、Access Key ID 和 Secret Access Key');
    }
    const publicBaseUrl = validatePublicBaseUrl(config.publicBaseUrl);
    if (!publicBaseUrl) throw new Error('请先填写 HTTPS 形式的 R2 公开访问域名');
    if (!file || !file.base64) throw new Error('没有读取到图片内容');
    if (!String(file.type || '').startsWith('image/')) throw new Error('只支持图片文件');

    const buffer = decodeBase64(file.base64);
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('图片不能超过 32 MB');
    const contentType = file.type || 'application/octet-stream';
    const objectKey = createObjectKey(config, file.name);
    const host = `${config.accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = `/${encodePath(config.bucket)}/${encodePath(objectKey)}`;
    const payloadHash = await sha256Hex(new Uint8Array(buffer));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`
    ].join('\n');
    const canonicalRequest = [
      'PUT',
      canonicalUri,
      '',
      canonicalHeaders,
      '',
      signedHeaders,
      payloadHash
    ].join('\n');
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest)
    ].join('\n');
    const dateKey = await hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
    const regionKey = await hmacSha256(dateKey, 'auto');
    const serviceKey = await hmacSha256(regionKey, 's3');
    const signingKey = await hmacSha256(serviceKey, 'aws4_request');
    const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(`https://${host}${canonicalUri}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        Authorization: authorization
      },
      body: buffer
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(detail ? `R2 上传失败（${response.status}）：${detail.slice(0, 180)}` : `R2 上传失败（${response.status}）`);
    }
    return {
      url: `${publicBaseUrl}/${encodePath(objectKey)}`,
      key: objectKey,
      filename: file.name || 'image'
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return undefined;
    if (message.type === 'GET_IMAGE_HOST_SETTINGS') {
      loadConfig()
        .then((config) => sendResponse({ ok: true, settings: imageHostSettings(config) }))
        .catch((error) => sendResponse({ ok: false, error: error.message || '读取图床设置失败' }));
      return true;
    }
    if (message.type !== 'UPLOAD_IMAGE') return undefined;
    uploadR2Image(message.file)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || '上传失败' }));
    return true;
  });
})();
