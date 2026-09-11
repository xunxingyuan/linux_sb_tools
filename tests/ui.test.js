const test = require('node:test');
const assert = require('node:assert/strict');
const { extension, source, tick, gacha, profile, forge, accountBar } = require('../test-support/extension');
const state = require('../lib/state');
const key = state.STORAGE_KEY;
const scripts = ['lib/state.js', 'lib/parser.js', 'lib/forge.js', 'lib/history.js', 'content.js'];
async function pageFor(ext, html, path = '/gacha', fetcher) {
  const dom = ext.dom(html, 'https://linux.sb' + path);
  dom.window.fetch = fetcher || (async url => ({ ok: true, text: async () => String(url).includes('gacha_profile') ? profile() : gacha() }));
  scripts.forEach(dom.evaluate);
  await tick();
  return dom;
}

test('popup reads ad toggle, saves only changed field, and keeps budget settings out of popup', async t => {
  const ext = extension({ [key]: { userId: '1', settings: { adRemovalEnabled: true, reservePoints: 100, forgeTarget: 'SSR', forgeKeepOne: false } } });
  const dom = ext.dom(source('popup.html'), 'https://extension.test/popup.html');
  t.after(dom.close);
  ['lib/state.js', 'lib/parser.js', 'popup.js'].forEach(dom.evaluate);
  await tick();
  const input = dom.document.getElementById('adRemovalEnabled');
  assert.equal(input.checked, true);
  assert.equal(dom.document.getElementById('reserve'), null);
  assert.equal(dom.document.querySelectorAll('.page-grid button').length, 3);
  assert.ok(dom.document.querySelector('.utility-row'));
  input.checked = false;
  input.dispatchEvent(new dom.window.Event('change'));
  await tick();
  const current = await ext.request('GET');
  assert.equal(current.settings.adRemovalEnabled, false);
  assert.equal(current.settings.reservePoints, 100);
  assert.equal(current.settings.forgeTarget, 'SSR');
  assert.equal(current.settings.forgeKeepOne, false);
});

test('options save retains forge preferences and compression presets preserve custom values', async t => {
  const ext = extension({ [key]: { userId: '1', settings: { forgeExcludedNames: ['萌新'], forgeTarget: 'SSR' } }, [state.IMAGE_CONFIG_KEY]: { compressionEnabled: true, compressionQuality: 0.87, maxDimension: 3000 } });
  const dom = ext.dom(source('options.html'), 'https://extension.test/options.html');
  t.after(dom.close);
  ['lib/state.js', 'options.js'].forEach(dom.evaluate);
  await tick();
  const $ = id => dom.document.getElementById(id);
  assert.equal($('imagePreset').value, 'custom');
  assert.equal($('imageAdvanced').open, false);
  assert.equal($('imageProvider'), null);
  $('reservePoints').value = '250';
  $('settingsForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await tick();
  assert.equal((await ext.request('GET')).settings.reservePoints, 250);
  assert.deepEqual((await ext.request('GET')).settings.forgeExcludedNames, ['萌新']);
  // A popup can change another field while this settings page is still open.
  await ext.request('SETTINGS', { patch: { adRemovalEnabled: true } });
  $('reservePoints').value = '300';
  $('settingsForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await tick();
  assert.equal((await ext.request('GET')).settings.adRemovalEnabled, true);
  $('imagePreset').value = 'high';
  $('imagePreset').dispatchEvent(new dom.window.Event('change'));
  $('imageHostForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(ext.data[state.IMAGE_CONFIG_KEY].compressionQuality, 0.9);
  assert.equal(ext.data[state.IMAGE_CONFIG_KEY].maxDimension, 4096);
});

test('gacha defaults to compact summary; settings updates preserve expanded detail and focused control', async t => {
  const ext = extension();
  const dom = await pageFor(ext, gacha());
  t.after(dom.close);
  const panel = dom.document.getElementById('linux-sb-title-assistant');
  assert.equal(panel.querySelectorAll('.lsa-toolbar').length, 1);
  const detail = panel.querySelector('details');
  assert.equal(detail.open, false);
  assert.equal(panel.querySelector('.lsa-chip'), null);
  detail.open = true;
  await tick();
  const input = panel.querySelector('[data-update]');
  input.focus();
  await ext.request('SETTINGS', { patch: { reservePoints: 500 } });
  await tick();
  assert.equal(panel.querySelector('details'), detail);
  assert.equal(detail.open, true);
  assert.equal(dom.document.activeElement, input);
});

test('forge keeps exclusions and preview collapsed, and updates local preferences without replacing the controls', async t => {
  const ext = extension();
  const dom = await pageFor(ext, forge(), '/gacha_forge_center');
  t.after(dom.close);
  const panel = dom.document.getElementById('linux-sb-title-assistant');
  assert.equal(panel.querySelector('details').open, false);
  assert.equal(panel.querySelector('.lsa-forge-preview'), null);
  const target = panel.querySelector('select');
  target.value = 'SSR'; target.focus();
  target.dispatchEvent(new dom.window.Event('change'));
  await tick();
  assert.equal(panel.querySelector('select'), target);
  assert.equal(target.value, 'SSR');
  assert.equal((await ext.request('GET')).settings.forgeTarget, 'SSR');
  panel.querySelector('details').open = true;
  await tick();
  assert.match(panel.querySelector('.lsa-forge-preview').textContent, /理论上限/);
});

test('failed or wrong-account refresh preserves cached inventory and shows error', async t => {
  const ext = extension();
  await ext.request('CURRENT', { userId: '1', current: { points: 500 } });
  const dom = await pageFor(ext, gacha(), '/gacha', async () => ({ ok: true, text: async () => profile('2') }));
  t.after(dom.close);
  assert.equal((await ext.request('GET', { userId: '1' })).current.points, 500);
  assert.match(dom.document.querySelector('[role="alert"]').textContent, /账号已变化/);
});

test('update crawls dynamically discovered pages; failed notification sync keeps old notification history', async t => {
  const ext = extension();
  const oldEvent = { time: 'old', text: 'old event', outputRarity: 'SSR', outcomes: [], outputCount: 1, inputCount: 8 };
  await ext.request('HISTORY', { userId: '1', generation: 0, forgeEvents: [oldEvent] });
  const visited = [];
  const fetcher = async value => {
    const url = new URL(value, 'https://linux.sb');
    if (url.pathname === '/gacha_profile') return { ok: true, text: async () => profile() };
    if (url.pathname === '/gacha') return { ok: true, text: async () => gacha() };
    if (url.searchParams.get('tab') === 'notifications') throw new Error('通知离线');
    const page = Number(url.searchParams.get('p'));
    visited.push(page);
    return { ok: true, text: async () => `${accountBar('1')}<main><div class="points-rewards-detail" data-id="${page}"><span class="points-rewards-reason">抽卡:称号系统</span><span class="points-rewards-change-value">-10</span><time class="points-rewards-time" datetime="2026-09-0${page}"></time></div><a href="/user/1?tab=points_rewards&p=${Math.min(page + 1, 3)}">下一页</a></main>` };
  };
  const dom = await pageFor(ext, gacha(), '/gacha', fetcher);
  t.after(dom.close);
  dom.document.querySelector('[data-update]').click();
  await tick(); await tick();
  assert.deepEqual(visited, [1, 2, 3]);
  const result = await ext.request('GET', { userId: '1' });
  assert.equal(result.historyRows.length, 3);
  assert.deepEqual(result.forgeEvents, [oldEvent]);
  assert.match(dom.document.querySelector('[role="alert"]').textContent, /部分更新未完成/);
});
