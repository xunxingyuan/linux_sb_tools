(function () {
  'use strict';

  if (location.hostname !== 'linux.sb' || location.pathname !== '/topic_edit') return;

  const CONFIG_KEY = 'linuxSbImageHostConfig';
  const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
  let host = null;
  let textarea = null;
  let fileInput = null;
  let status = null;
  let queue = null;
  let removePageListeners = () => {};

  async function loadConfig() {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    return { enabled: false, provider: 'cloudflare-r2', ...(stored[CONFIG_KEY] || {}) };
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

  async function uploadFile(file, item) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} 超过 32 MB`);
    item.textContent = `${file.name} · 上传中…`;
    const response = await chrome.runtime.sendMessage({
      type: 'UPLOAD_IMAGE',
      file: { name: file.name, type: file.type, base64: encodeBase64(await file.arrayBuffer()) }
    });
    if (!response || !response.ok || !response.url) throw new Error(response?.error || `${file.name} 上传失败`);
    const alt = file.name.replace(/[\[\]\\]/g, '').replace(/\s+/g, ' ').trim() || '图片';
    insertMarkdown(`![${alt}](${response.url})`);
    item.textContent = `${file.name} · 已插入正文`;
  }

  async function handleFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    let success = 0;
    for (const file of list) {
      const item = makeQueueItem(file);
      try {
        await uploadFile(file, item);
        success += 1;
      } catch (error) {
        item.textContent = `${file.name} · ${error.message || '上传失败'}`;
        item.classList.add('is-error');
      }
    }
    setStatus(success === list.length ? `已上传 ${success} 张图片并插入正文。` : `完成 ${success}/${list.length} 张图片，失败项请重试。`, success !== list.length);
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
    textarea = document.querySelector('textarea[name="body"]');
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
