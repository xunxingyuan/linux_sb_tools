(function () {
  'use strict';

  const isTopicEdit = location.pathname === '/topic_edit';
  const isTopicPage = location.pathname.startsWith('/topic/');
  if (location.hostname !== 'linux.sb' || (!isTopicEdit && !isTopicPage)) return;

  const CONFIG_KEY = 'linuxSbImageHostConfig';
  const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
  const publicSettings = globalThis.LinuxSbState.imageSettings;
  const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  let host = null;
  let textarea = null;
  let fileInput = null;
  let status = null;
  let queue = null;
  let removePageListeners = () => {};

  async function loadConfig() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_IMAGE_HOST_SETTINGS' });
      return publicSettings((response && response.ok && response.settings) || undefined);
    } catch (_error) {
      return publicSettings();
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(message, isError) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(isError));
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        let bitmap;
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (_error) {
          bitmap = await createImageBitmap(file);
        }
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close()
        };
      } catch (_error) {
        // Fall back to an object URL when ImageBitmap cannot decode this file.
      }
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('图片解码失败'));
        element.src = objectUrl;
      });
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(objectUrl)
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  async function prepareUpload(file, settings) {
    const original = {
      blob: file,
      name: file.name || 'image',
      type: file.type || 'application/octet-stream',
      originalSize: file.size,
      uploadSize: file.size,
      compressed: false
    };
    if (!settings.compressionEnabled || !COMPRESSIBLE_IMAGE_TYPES.has(file.type) || !file.size) return original;

    let decoded = null;
    try {
      decoded = await decodeImage(file);
      const maxDimension = settings.maxDimension;
      const longestSide = Math.max(decoded.width, decoded.height);
      const scale = Math.min(1, maxDimension / longestSide);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return original;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(decoded.source, 0, 0, width, height);
      const compressed = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/webp', settings.compressionQuality);
      });
      if (!compressed || compressed.size >= file.size) return original;

      const sourceName = String(file.name || 'image');
      const stem = sourceName.replace(/\.[^/.]+$/, '') || 'image';
      return {
        ...original,
        blob: compressed,
        name: `${stem}.webp`,
        type: 'image/webp',
        uploadSize: compressed.size,
        compressed: true
      };
    } catch (_error) {
      return original;
    } finally {
      if (decoded) decoded.release();
    }
  }

  function insertMarkdown(markdown) {
    const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const prefix = before && !/\n$/.test(before) ? '\n' : '';
    const suffix = after && !/^\n/.test(after) ? '\n' : '';
    const value = `${prefix}${markdown}${suffix}`;
    textarea.setRangeText(value, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function encodeBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function makeQueueItem(file) {
    const item = element('li', 'lsih-queue-item', `${file.name} · 准备上传`);
    queue.append(item);
    return item;
  }

  async function uploadFile(file, item, settings) {
    const fileType = String(file.type || '');
    if (!fileType.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} 超过 32 MB`);
    item.textContent = `${file.name} · ${formatBytes(file.size)} · 处理中…`;
    const prepared = await prepareUpload(file, settings);
    const sizeSummary = prepared.compressed
      ? `${formatBytes(prepared.originalSize)} → ${formatBytes(prepared.uploadSize)}`
      : `${formatBytes(prepared.uploadSize)} · 原图`;
    item.textContent = `${file.name} · ${sizeSummary} · 上传中…`;
    const response = await chrome.runtime.sendMessage({
      type: 'UPLOAD_IMAGE',
      file: { name: prepared.name, type: prepared.type, base64: encodeBase64(await prepared.blob.arrayBuffer()) }
    });
    if (!response || !response.ok || !response.url) throw new Error(response?.error || `${file.name} 上传失败`);
    const alt = file.name.replace(/[\[\]\\]/g, '').replace(/\s+/g, ' ').trim() || '图片';
    insertMarkdown(`![${alt}](${response.url})`);
    item.textContent = `${file.name} · ${sizeSummary} · 已插入正文`;
    return prepared.compressed;
  }

  async function handleFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const settings = await loadConfig();
    let success = 0;
    let compressed = 0;
    for (const file of list) {
      const item = makeQueueItem(file);
      try {
        if (await uploadFile(file, item, settings)) compressed += 1;
        success += 1;
      } catch (error) {
        item.textContent = `${file.name} · ${error.message || '上传失败'}`;
        item.classList.add('is-error');
      }
    }
    const compressionNote = compressed ? `，压缩 ${compressed} 张` : '';
    setStatus(success === list.length ? `已上传 ${success} 张图片并插入正文${compressionNote}。` : `完成 ${success}/${list.length} 张图片${compressionNote}，失败项请重试。`, success !== list.length);
  }

  function unmount() {
    removePageListeners();
    removePageListeners = () => {};
    if (host) host.remove();
    host = null;
    textarea = null;
    fileInput = null;
    status = null;
    queue = null;
  }

  function mount() {
    if (host) return;
    const editorSelector = isTopicPage
      ? 'form[action="/reply_edit"] textarea[name="body"]'
      : 'textarea[name="body"]';
    textarea = document.querySelector(editorSelector);
    if (!textarea) return;

    host = element('section', 'lsih-panel');
    host.id = 'linux-sb-image-host';
    const header = element('div', 'lsih-header');
    header.append(element('strong', 'lsih-title', '🖼️ 图床助手'), element('span', 'lsih-badge', 'Cloudflare R2 · 公开直链'));
    const hint = element('div', 'lsih-hint', '选择图片、拖拽图片，或直接把图片粘贴到正文框；上传后会自动插入 Markdown 图片链接。');
    const controls = element('div', 'lsih-controls');
    const choose = element('button', 'lsih-choose', '选择图片');
    choose.type = 'button';
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.hidden = true;
    const dropzone = element('div', 'lsih-dropzone', '也可将图片拖到这里');
    dropzone.setAttribute('role', 'button');
    dropzone.tabIndex = 0;
    status = element('div', 'lsih-status', '图床助手已启用');
    queue = element('ul', 'lsih-queue');

    choose.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });
    const onDragOver = (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    };
    const onDragLeave = () => dropzone.classList.remove('is-dragging');
    const onDrop = (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
      handleFiles(event.dataTransfer.files);
    };
    const onPaste = (event) => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      handleFiles(files);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    };
    dropzone.addEventListener('dragover', onDragOver);
    dropzone.addEventListener('dragleave', onDragLeave);
    dropzone.addEventListener('drop', onDrop);
    dropzone.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('paste', onPaste);
    removePageListeners = () => {
      dropzone.removeEventListener('dragover', onDragOver);
      dropzone.removeEventListener('dragleave', onDragLeave);
      dropzone.removeEventListener('drop', onDrop);
      dropzone.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('paste', onPaste);
    };

    controls.append(choose, dropzone, fileInput);
    host.append(header, hint, controls, status, queue);
    const anchor = textarea.closest('.nb-editor') || textarea.parentElement;
    anchor.insertBefore(host, textarea.nextSibling);
  }

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local' || !changes[CONFIG_KEY]) return;
    const config = await loadConfig();
    if (config.enabled && config.provider === 'cloudflare-r2') mount();
    else unmount();
  });

  loadConfig().then((config) => {
    if (config.enabled && config.provider === 'cloudflare-r2') mount();
  }).catch(() => {});
})();
