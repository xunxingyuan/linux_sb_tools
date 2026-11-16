(function (global) {
  'use strict';

  const STORAGE_KEY = 'linuxSbUpdateStatus';
  const MANIFEST_URL = 'https://raw.githubusercontent.com/xunxingyuan/linux_sb_tools/main/manifest.json';
  const REPOSITORY_URL = 'https://github.com/xunxingyuan/linux_sb_tools';

  function versionParts(version) {
    if (!/^\d+(?:\.\d+){0,3}$/.test(String(version))) throw new Error('版本号格式无效');
    return String(version).split('.').map(Number);
  }

  function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
    }
    return 0;
  }

  const api = { STORAGE_KEY, MANIFEST_URL, REPOSITORY_URL, compareVersions };
  global.LinuxSbUpdate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
