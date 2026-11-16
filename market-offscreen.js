(function () {
  'use strict';

  const market = globalThis.LinuxSbMarket;
  const stats = globalThis.LinuxSbTitleStats;

  async function scan(rules) {
    const results = [];
    let accountId = '';
    for (const rule of rules) {
      for (let page = 1; page <= 10; page += 1) {
        const response = await fetch(market.searchUrl(rule.title, page), { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`市场页面读取失败（${response.status}）`);
        const doc = new DOMParser().parseFromString(market.inertHtml(await response.text()), 'text/html');
        const currentAccount = stats.findUserId(doc);
        if (!currentAccount) throw new Error('无法确认登录账号，请先登录市场页面');
        if (accountId && accountId !== currentAccount) throw new Error('扫描时账号发生变化，请重试');
        accountId = currentAccount;
        const { listings, nextPage } = market.parsePage(doc, page);
        results.push(...listings.filter((listing) => market.matches(rule, listing)).map((listing) => ({ ...listing, ruleId: rule.id })));
        if (!nextPage || !listings.length || listings.every((listing) => listing.price > rule.maxPrice)) break;
      }
    }
    return { accountId, matches: results };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'MARKET_SCAN' || message.target !== 'offscreen') return undefined;
    scan(message.rules).then((result) => respond({ ok: true, ...result }), (error) => respond({ ok: false, error: error.message }));
    return true;
  });
})();
