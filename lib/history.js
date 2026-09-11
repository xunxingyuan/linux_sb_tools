(function (global) {
  'use strict';
  // Pagination is discovered on every page, including pages hidden by an ellipsis.
  async function collectPages({ firstUrl, fetchPage, parsePage, pageUrls, known = [], incremental = false, onProgress = () => {}, key, maxPages = 1000 }) {
    const base = new URL(firstUrl);
    let lastPage = 1;
    const rows = [];
    const knownIds = new Set(known.filter(row => row.id).map(key));
    for (let page = 1; page <= lastPage; page += 1) {
      if (page > maxPages) throw new Error(`分页超过 ${maxPages} 页，本地历史保留；请稍后重试`);
      const url = new URL(base);
      url.searchParams.set('p', String(page));
      const doc = await fetchPage(url.href);
      const batch = parsePage(doc);
      for (const link of pageUrls(doc, url.href)) {
        const next = new URL(link, url);
        if (next.origin !== base.origin || next.pathname !== base.pathname || next.searchParams.get('tab') !== base.searchParams.get('tab')) continue;
        const number = Number(next.searchParams.get('p') || 1);
        if (Number.isSafeInteger(number) && number > 0) lastPage = Math.max(lastPage, number);
      }
      if (lastPage > maxPages) throw new Error(`分页超过 ${maxPages} 页，本地历史保留`);
      rows.push(...batch);
      onProgress(page, lastPage);
      // Only stable server IDs can establish a safe incremental boundary.
      if (incremental && batch.length && batch.every(row => row.id && knownIds.has(key(row)))) {
        return { rows, pages: page, mode: 'incremental', reachedEnd: false };
      }
    }
    return { rows, pages: lastPage, mode: 'full', reachedEnd: true };
  }
  global.LinuxSbHistory = { collectPages };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LinuxSbHistory;
})(globalThis);
