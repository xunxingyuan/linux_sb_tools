const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const market = require('../lib/market');

test('market parser reads listing id and unit price and filters exact title', () => {
  const doc = new JSDOM(`<form class="gacha-market-filters"></form><div class="gacha-market-grid">
    <article class="gacha-market-card"><span class="gacha-title-name">欧皇</span><form class="gacha-market-buy" data-gacha-market-price="280"><input name="listing_id" value="42"><input name="quantity" max="2"></form></article>
    <article class="gacha-market-card"><span class="gacha-title-name">欧皇·限定</span><form class="gacha-market-buy" data-gacha-market-price="200"><input name="listing_id" value="43"><input name="quantity" max="1"></form></article>
  </div><a href="/gacha_market?q=x&p=2">下一页</a>`).window.document;
  const page = market.parsePage(doc);
  assert.equal(page.nextPage, true);
  assert.deepEqual(page.listings.map(item => item.id), ['42', '43']);
  assert.deepEqual(page.listings.filter(item => market.matches({ title: '欧皇', maxPrice: 280 }, item)).map(item => item.id), ['42']);
  assert.equal(market.searchUrl('欧皇', 2), 'https://linux.sb/gacha_market?q=%E6%AC%A7%E7%9A%87&sort=price_asc&p=2');
});

test('market HTML is inert before DOM parsing without losing listing fields', () => {
  const html = `<script>window.shouldNotRun = true</script><div class="bar-right" onmouseover="alert(1)"><a href="/user/1">我的账号</a></div>
    <form class="gacha-market-filters" onsubmit="return false"></form>
    <article class="gacha-market-card"><span class="gacha-title-name">反贼</span>
    <form class="gacha-market-buy" data-gacha-market-price="4999" onsubmit='return confirm("购买")'>
    <input name="listing_id" value="42"><input name="quantity" max="2"></form></article>`;
  const inert = market.inertHtml(html);
  assert.doesNotMatch(inert, /<script|onmouseover|onsubmit/i);
  const doc = new JSDOM(inert).window.document;
  assert.deepEqual(market.parsePage(doc).listings.map(item => [item.id, item.title, item.price]), [['42', '反贼', 4999]]);
});
