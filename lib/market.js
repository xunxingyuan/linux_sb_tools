(function (global) {
  'use strict';

  const CONFIG_KEY = 'linuxSbMarketWatchConfig';
  const RUNTIME_KEY = 'linuxSbMarketWatchRuntime';
  const MARKET_URL = 'https://linux.sb/gacha_market';
  const INTERVALS = [5, 10, 30, 60];

  function normalizeTitle(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  function normalizeConfig(saved = {}) {
    return {
      enabled: saved.enabled === true,
      intervalMinutes: INTERVALS.includes(Number(saved.intervalMinutes)) ? Number(saved.intervalMinutes) : 5,
      rules: Array.isArray(saved.rules) ? saved.rules.map((rule) => ({
        id: String(rule.id || ''), title: normalizeTitle(rule.title), maxPrice: Number(rule.maxPrice)
      })).filter((rule) => rule.id && rule.title && Number.isSafeInteger(rule.maxPrice) && rule.maxPrice > 0).slice(0, 10) : []
    };
  }

  function searchUrl(title, page = 1) {
    const url = new URL(MARKET_URL);
    url.searchParams.set('q', normalizeTitle(title));
    url.searchParams.set('sort', 'price_asc');
    if (page > 1) url.searchParams.set('p', String(page));
    return url.href;
  }

  function inertHtml(html) {
    return String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  function parsePage(doc, page = 1) {
    if (!doc.querySelector('.gacha-market-filters')) throw new Error('未找到市场列表，请确认已登录并检查页面是否改版');
    const listings = [...doc.querySelectorAll('.gacha-market-card')].map((card) => {
      const form = card.querySelector('form.gacha-market-buy');
      const id = form?.querySelector('[name="listing_id"]')?.value || '';
      const title = normalizeTitle(card.querySelector('.gacha-title-name')?.textContent || form?.dataset.gachaMarketTitle);
      const price = Number(form?.dataset.gachaMarketPrice);
      const quantity = Number(form?.querySelector('[name="quantity"]')?.max || 0);
      return { id, title, price, quantity };
    }).filter((item) => item.id && item.title && Number.isSafeInteger(item.price) && item.price > 0 && item.quantity > 0);
    const nextPage = [...doc.querySelectorAll('a[href]')].some((link) => {
      try {
        const url = new URL(link.getAttribute('href'), MARKET_URL);
        return url.origin === 'https://linux.sb' && url.pathname === '/gacha_market' && Number(url.searchParams.get('p')) === page + 1;
      } catch (_error) { return false; }
    });
    return { listings, nextPage };
  }

  function matches(rule, listing) {
    return normalizeTitle(listing.title) === normalizeTitle(rule.title) && listing.price <= rule.maxPrice && listing.quantity > 0;
  }

  const api = { CONFIG_KEY, RUNTIME_KEY, MARKET_URL, INTERVALS, normalizeTitle, normalizeConfig, searchUrl, inertHtml, parsePage, matches };
  global.LinuxSbMarket = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
