const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gacha, profile, accountBar } = require('../test-support/extension');
const root = path.resolve(__dirname, '..');
const localVersion = require('../manifest.json').version;
const nextVersion = localVersion.replace(/\d+$/, value => String(Number(value) + 1));
const titleStateKey = 'linuxSbTitleAssistantState';
const startInventory = [
  { name: '萌新', rarity: 'N', count: 28 }, { name: '常客', rarity: 'R', count: 5 },
  { name: '高手', rarity: 'SR', count: 16 }, { name: '欧皇', rarity: 'SSR', count: 1 }
];
const sidebar = '<aside class="sidebar"><section class="sidebar-card"><strong>测试账号</strong><a href="/user/1?tab=points_rewards">我的积分</a><a href="/user/1?tab=notifications">我的通知</a></section></aside>';
const styles = `body{margin:0;background:#f6f7f9;color:#334155;font:14px system-ui}.layout{display:flex;max-width:1100px;gap:20px;margin:20px auto;padding:0 16px}main{flex:1;min-width:0}.sidebar{width:180px;flex-shrink:0}.sidebar-card{background:#fff;border:1px solid #e2e8f0;padding:16px;border-radius:8px}.sidebar-card a{display:block;margin-top:12px}.gacha-center-stat{margin:12px 0;font-size:18px}.gacha-all-item{display:inline-flex;gap:6px;margin:4px;padding:8px;border:1px solid #ddd;background:white;border-radius:6px}.gacha-actions, main>form{margin:16px 0;border:1px solid #ddd;border-radius:8px;padding:16px;background:white}main>form input[type=number]{width:70px}main>form article{padding:8px}main>form button,.gacha-actions button{padding:8px 20px}label{width:32px;display:block}input[type=checkbox]{width:36px}input,button,select{font:inherit}@media(max-width:720px){.sidebar{display:none}.layout{margin:12px 0}}`;
const wrap = html => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style></head><body><div class="layout">'+html.replace(accountBar('1'), '')+sidebar+'</div></body></html>';
const test = base.extend({
  app: async ({}, use) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-browser-'));
    const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-extension-'));
    fs.cpSync(root, extensionDir, { recursive: true, filter: source => {
      const top = path.relative(root, source).split(path.sep)[0];
      return !['.git', 'node_modules', 'browser-tests', 'tests', 'test-results', 'docs'].includes(top) && !source.endsWith('.zip');
    } });
    const marketHtml = `<div class="bar-right"><a href="/user/1">我的账号</a></div>
      <form class="gacha-market-filters"></form><div class="gacha-market-grid">
      <article class="gacha-market-card"><span class="gacha-title-name">欧皇</span><form class="gacha-market-buy" data-gacha-market-price="250" onsubmit="return false"><input name="listing_id" value="cheap"><input name="quantity" max="1"></form></article>
      <article class="gacha-market-card"><span class="gacha-title-name">欧皇</span><form class="gacha-market-buy" data-gacha-market-price="300"><input name="listing_id" value="expensive"><input name="quantity" max="1"></form></article>
      </div>`;
    fs.writeFileSync(path.join(extensionDir, 'market-test-fetch.js'), `window.fetch = async () => ({ ok: true, text: async () => ${JSON.stringify(marketHtml)} });`);
    const offscreenPath = path.join(extensionDir, 'market-offscreen.html');
    fs.writeFileSync(offscreenPath, fs.readFileSync(offscreenPath, 'utf8').replace('<script src="market-offscreen.js"></script>', '<script src="market-test-fetch.js"></script><script src="market-offscreen.js"></script>'));
    fs.writeFileSync(path.join(extensionDir, 'update-test-fetch.js'), `const originalFetch = globalThis.fetch; globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://raw.githubusercontent.com/xunxingyuan/linux_sb_tools/')) {
        const data = await chrome.storage.local.get('linuxSbTestRemoteVersion');
        return { ok: true, json: async () => ({ version: data.linuxSbTestRemoteVersion || ${JSON.stringify(localVersion)} }) };
      }
      return originalFetch(url, options);
    };`);
    const backgroundPath = path.join(extensionDir, 'background.js');
    fs.writeFileSync(backgroundPath, `importScripts('update-test-fetch.js');\n${fs.readFileSync(backgroundPath, 'utf8')}`);
    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      headless: true, args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
      viewport: { width: 1100, height: 800 }
    });
    let inventory = structuredClone(startInventory);
    const submits = [];
    let rejectForge = false;
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      if (url.origin !== 'https://linux.sb') return route.abort();
      let html;
      if (request.method() === 'POST') {
        const source = url.pathname.split('/').at(-1);
        submits.push(source);
        if (!rejectForge) {
          const form = new URLSearchParams(request.postData());
          const cycles = Number(form.get('forge_count'));
          for (const name of form.getAll('titles[]')) inventory.find(t => t.name === name).count -= Number(form.get(`quantity[${name}]`));
          const target = { N: 'R', R: 'SR', SR: 'SSR' }[source];
          inventory.find(t => t.rarity === target).count += cycles;
        }
        // Route interception doesn't re-run on redirect chains. Use a new local
        // navigation, with DNS disabled as a second barrier against real requests.
        return route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/gacha_forge_center")</script>' });
      }
      if (url.pathname === '/gacha') html = gacha();
      else if (url.pathname === '/gacha_profile') html = profile('1', inventory);
      else if (url.pathname === '/topic/1') html = '<main><form action="/reply_edit"><div class="nb-editor"><textarea name="body"></textarea></div></form></main>';
      else if (url.pathname === '/gacha_market') {
        const entries = [
          { id: 'cheap', name: '欧皇', price: 250 },
          { id: 'expensive', name: '欧皇', price: 300 },
          { id: 'other', name: '传说之龙', price: 200 }
        ].filter(item => !url.searchParams.get('q') || item.name.includes(url.searchParams.get('q')));
        html = `<main><form class="gacha-market-filters"><input name="q"></form><div class="gacha-market-grid">${entries.map(item => `<article class="gacha-market-card"><span class="gacha-title-name">${item.name}</span><form class="gacha-market-buy" data-gacha-market-title="${item.name}" data-gacha-market-price="${item.price}"><input name="listing_id" value="${item.id}"><input name="quantity" type="number" max="1"><button>购买</button></form></article>`).join('')}</div></main>`;
      }
      else if (url.pathname === '/gacha_forge_center') {
        html = `<main class="gacha-center-page"><nav class="gacha-tabs" role="tablist">${['我的称号','称号抽取','称号熔炼','称号回收','UR 合成','称号交易'].map(label => `<a role="tab" href="#">${label}</a>`).join('')}</nav><div class="gacha-center-stat">积分 903</div>${['N','R','SR'].map(rarity => `<form action="/forge/${rarity}" method="post">${inventory.filter(t => t.rarity === rarity).map(t => `<article><span class="gacha-title-name">${t.name}</span><label><input name="titles[]" type="checkbox" value="${t.name}" data-gacha-forge-rarity="${rarity.toLowerCase()}"><input name="quantity[${t.name}]" type="number" min="1" max="${t.count}" value="1"></label></article>`).join('')}<input name="forge_count" data-gacha-forge-count><button data-gacha-forge-source="${rarity}">${rarity} 熔铸</button></form>`).join('')}</main>`;
      } else if (url.pathname === '/user/1') {
        html = '<main><p>暂无记录</p></main>';
      } else return route.fulfill({ status: 404, body: 'Offline test' });
      return route.fulfill({ contentType: 'text/html', body: wrap(html) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    try {
      await use({ context, page, worker, id, submits, inventory: () => inventory, failForge: () => { rejectForge = true; }, errors });
    } finally {
      await context.close();
      fs.rmSync(profileDir, { recursive: true, force: true });
      fs.rmSync(extensionDir, { recursive: true, force: true });
    }
  }
});

async function openForge(app) {
  await app.page.goto('https://linux.sb/gacha_forge_center');
  await expect(app.page.locator('#linux-sb-title-assistant button', { hasText: /^一键熔铸$/ })).toBeEnabled();
  await expect(app.page.locator('#linux-sb-title-assistant').evaluate((node) => node.previousElementSibling?.classList.contains('gacha-tabs'))).resolves.toBe(true);
}
async function startForge(app) {
  const panel = app.page.locator('#linux-sb-title-assistant');
  await panel.locator('select').selectOption('SSR');
  await panel.getByRole('button', { name: '一键熔铸', exact: true }).click();
  await panel.getByRole('button', { name: '确认一键熔铸', exact: true }).click();
}

test('compact panels fit desktop/mobile and settings changes preserve controls', async ({ app }) => {
  await app.page.goto('https://linux.sb/gacha');
  const panel = app.page.locator('#linux-sb-title-assistant');
  await expect(panel.locator('.lsa-inline-stat').first()).toHaveText('积分 903');
  expect((await panel.boundingBox()).height).toBeLessThan(95);
  await expect(panel.locator('details')).not.toHaveAttribute('open');
  fs.mkdirSync(path.join(root, 'docs/screenshots'), { recursive: true });
  await panel.screenshot({ path: path.join(root, 'docs/screenshots/compact-gacha.png') });
  for (const width of [390, 320]) {
    await app.page.setViewportSize({ width, height: 800 });
    expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await panel.boundingBox()).height).toBeLessThan(135);
  }
  await openForge(app);
  await expect(panel.locator('details')).not.toHaveAttribute('open');
  expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await app.page.setViewportSize({ width: 1100, height: 800 });
  expect((await panel.boundingBox()).height).toBeLessThan(95);
  await panel.screenshot({ path: path.join(root, 'docs/screenshots/compact-forge.png') });
  await panel.locator('summary').click();
  await expect(panel.locator('.lsa-forge-preview')).toContainText('理论上限');
  const keyboard = panel.locator('.lsa-forge-exclusion-item input[value="键盘侠"]');
  await expect(keyboard).toBeChecked();
  await expect(keyboard.locator('..')).toContainText('SR 键盘侠');
  const exclusion = await panel.locator('.lsa-forge-exclusion-item').first().boundingBox();
  expect(exclusion.width).toBeGreaterThan(60);
  expect(exclusion.height).toBeLessThan(36);
  await panel.screenshot({ path: path.join(root, 'docs/screenshots/compact-forge-details.png') });
  expect(app.errors).toEqual([]);
});

test('real extension popup/options use shared storage without losing forge preferences', async ({ app }) => {
  await openForge(app);
  await app.page.locator('#linux-sb-title-assistant select').selectOption('SSR');
  const settings = await app.context.newPage();
  await settings.goto(`chrome-extension://${app.id}/options.html`);
  await settings.locator('#reservePoints').fill('250');
  await expect(settings.locator('#adRemovalEnabled, #imageHostForm')).toHaveCount(0);
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(settings.locator('#message')).toHaveText('设置已保存。');
  const accountBox = await settings.locator('#accountLabel').boundingBox();
  const settingsButtons = await settings.locator('#settingsForm > .button-row').boundingBox();
  expect(accountBox.y + accountBox.height).toBeLessThanOrEqual(settingsButtons.y);
  const popup = await app.context.newPage();
  await popup.setViewportSize({ width: 360, height: 620 });
  await popup.goto(`chrome-extension://${app.id}/popup.html`);
  await expect(popup.locator('#adRemovalEnabled')).toHaveCount(0);
  await expect(popup.locator('.page-grid button')).toHaveCount(4);
  await expect(popup.locator('.utility-row')).toBeVisible();
  await popup.screenshot({ path: path.join(root, 'docs/screenshots/popup-simplified.png'), fullPage: true });
  const saved = await app.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], titleStateKey);
  expect(saved.settings.reservePoints).toBe(250);
  expect(saved.settings.forgeTarget).toBe('SSR');
  expect(saved.settings.adRemovalEnabled).toBeUndefined();
  await settings.screenshot({ path: path.join(root, 'docs/screenshots/settings-simplified.png'), fullPage: true });
});

test('forge verifies each successful stage across page navigation', async ({ app }) => {
  await openForge(app);
  await startForge(app);
  await expect(app.page.getByText('可执行的熔铸阶段已完成，库存不足的阶段已跳过。')).toBeVisible({ timeout: 20000 });
  expect(app.submits).toEqual(['N', 'R', 'SR']);
  expect(app.inventory().map(t => t.count)).toEqual([1, 2, 4, 3]);
  const saved = await app.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], titleStateKey);
  expect(saved.accounts['1'].pendingForge).toBeNull();
  expect(app.errors).toEqual([]);
});

test('retired helpers stay absent even with old settings', async ({ app }) => {
  await app.worker.evaluate(async () => chrome.storage.local.set({ linuxSbImageHostConfig: { enabled: true, provider: 'cloudflare-r2' } }));
  await app.page.goto('https://linux.sb/topic/1');
  await expect(app.page.locator('#linux-sb-image-host')).toHaveCount(0);
  await expect(app.page.locator('html')).not.toHaveClass(/linux-sb-ad-removal-enabled/);
  await app.page.goto('https://linux.sb/gacha');
  await expect(app.page.locator('#linux-sb-title-assistant')).toBeVisible();
  await expect(app.page.locator('html')).not.toHaveClass(/linux-sb-ad-removal-enabled/);
  expect(app.errors).toEqual([]);
});

test('market watch notifies on a matching price without purchasing', async ({ app }) => {
  const settings = await app.context.newPage();
  await settings.goto(`chrome-extension://${app.id}/options.html`);
  await settings.locator('.market-title').fill('欧皇');
  await settings.locator('.market-price').fill('280');
  await settings.locator('#marketEnabled').check();
  await settings.getByRole('button', { name: '保存监控' }).click();
  await expect(settings.locator('#marketMessage')).toContainText('检查完成', { timeout: 20000 });
  await expect(settings.locator('#marketStatus')).toContainText('最近命中 1 条');
  const runtime = await app.worker.evaluate(async () => (await chrome.storage.local.get('linuxSbMarketWatchRuntime')).linuxSbMarketWatchRuntime);
  expect(runtime.matches).toHaveLength(1);
  expect(runtime.matches[0].id).toBe('cheap');
  expect(Object.keys(runtime.notified)).toHaveLength(1);
  const notifications = await app.worker.evaluate(async () => chrome.notifications.getAll());
  expect(Object.keys(notifications)).toHaveLength(1);
  const marketTabs = await app.worker.evaluate(async () => chrome.tabs.query({ url: 'https://linux.sb/gacha_market*' }));
  expect(marketTabs).toHaveLength(0);
  const alarm = await app.worker.evaluate(async () => chrome.alarms.get('linux-sb-market-watch'));
  expect(alarm.periodInMinutes).toBe(5);
  expect(app.submits).toEqual([]);
  await app.page.goto('https://linux.sb/gacha');
  const popup = await app.context.newPage();
  await popup.setViewportSize({ width: 360, height: 620 });
  await popup.goto(`chrome-extension://${app.id}/popup.html`);
  await expect(popup.locator('#marketBadge')).toHaveText('监控中');
  await expect(popup.locator('#marketSummary')).toContainText('最近命中 1 条');
  await expect(popup.locator('#marketRules')).toContainText('欧皇');
  await expect(popup.locator('#marketRules')).toContainText('≤ 280 分');
  await popup.screenshot({ path: path.join(root, 'docs/screenshots/market-watch-popup.png'), fullPage: true });
  await settings.locator('#marketCheckNow').click();
  await expect(settings.locator('#marketMessage')).toContainText('检查完成');
  const second = await app.worker.evaluate(async () => (await chrome.storage.local.get('linuxSbMarketWatchRuntime')).linuxSbMarketWatchRuntime);
  expect(Object.keys(second.notified)).toHaveLength(1);
  await settings.locator('#marketEnabled').uncheck();
  await settings.getByRole('button', { name: '保存监控' }).click();
  await expect(settings.locator('#marketMessage')).toContainText('监控已关闭');
  await expect(popup.locator('#marketBadge')).toHaveText('已暂停');
  await expect(popup.locator('#marketSummary')).toContainText('已保存 1 条规则');
  expect(await app.worker.evaluate(async () => chrome.alarms.get('linux-sb-market-watch'))).toBeUndefined();
});

test('popup detects a newer GitHub version and explains the local update step', async ({ app }) => {
  await app.worker.evaluate(async version => chrome.storage.local.set({ linuxSbTestRemoteVersion: version }), nextVersion);
  const popup = await app.context.newPage();
  await popup.setViewportSize({ width: 360, height: 620 });
  await popup.goto(`chrome-extension://${app.id}/popup.html`);
  await popup.locator('#checkUpdate').click();
  await expect(popup.locator('#updateNotice')).toBeVisible();
  await expect(popup.locator('#updateTitle')).toContainText(nextVersion);
  await expect(popup.locator('#updateDetail')).toContainText('替换本地扩展文件');
  await expect(popup.locator('#reloadUpdatedFiles')).toHaveText('替换文件后重载');
  expect(await app.worker.evaluate(async () => chrome.action.getBadgeText({}))).toBe('1');
  await popup.screenshot({ path: path.join(root, 'docs/screenshots/update-available-popup.png'), fullPage: true });
});

test('failed forge response pauses without submitting the next stage', async ({ app }) => {
  app.failForge();
  await openForge(app);
  await startForge(app);
  await expect(app.page.locator('.lsa-forge-progress')).toContainText('未能确认上一阶段成功', { timeout: 10000 });
  expect(app.submits).toEqual(['N']);
  const saved = await app.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], titleStateKey);
  expect(saved.accounts['1'].pendingForge.stageIndex).toBe(0);
  expect(saved.accounts['1'].pendingForge.phase).toBe('awaiting');
});

test('second tab never executes another tab task; stopping countdown prevents submission', async ({ app }) => {
  await openForge(app);
  await startForge(app);
  await expect(app.page.locator('.lsa-forge-progress')).toContainText('3 秒后继续');
  const other = await app.context.newPage();
  await other.goto('https://linux.sb/gacha_forge_center');
  await expect(other.locator('.lsa-forge-progress')).toContainText('另一个标签页');
  await app.page.getByRole('button', { name: '停止任务' }).click();
  await expect(app.page.locator('.lsa-forge-progress')).toHaveCount(0);
  await app.page.waitForTimeout(3300);
  expect(app.submits).toEqual([]);
});

test('draw after successful update reads the visible fee and preserves the submitted draw mode', async ({ app }) => {
  const submitted = [];
  const html = gacha().replace('<button data-cost="10">单抽</button>',
    '<button name="mode" value="single">抽一次（10 积分）</button><button name="mode" value="ten">十连抽（<span>90</span> 积分）</button>');
  await app.context.route('https://linux.sb/gacha', route => {
    if (route.request().method() === 'POST') submitted.push(new URLSearchParams(route.request().postData()).get('mode'));
    return route.fulfill({ contentType: 'text/html', body: wrap(html) });
  });
  await app.page.goto('https://linux.sb/gacha');
  const panel = app.page.locator('#linux-sb-title-assistant');
  await expect(panel.locator('.lsa-inline-stat').first()).toHaveText('积分 903');
  await panel.getByRole('button', { name: '更新数据', exact: true }).click();
  await expect(panel.locator('.lsa-notice')).toHaveText('数据已更新。');
  await app.page.locator('.gacha-actions [value="ten"]').click();
  await expect(panel.locator('.lsa-confirm')).toContainText('90 积分');
  expect(submitted).toEqual([]);
  await panel.getByRole('button', { name: '确认抽取', exact: true }).click();
  await expect.poll(() => submitted).toEqual(['ten']);
  expect(app.errors).toEqual([]);
});

test('draw from a clean installation checks balance independently of inventory availability', async ({ app }) => {
  let points = 903;
  const submitted = [];
  await app.context.route('https://linux.sb/gacha_profile', route => route.fulfill({ status: 503, body: 'Offline inventory' }));
  await app.context.route('https://linux.sb/gacha', route => {
    if (route.request().method() === 'POST') submitted.push(route.request().postData());
    return route.fulfill({ contentType: 'text/html', body: wrap(gacha('1', points).replace('<button data-cost="10">单抽</button>', '<button>抽一次（10 积分）</button>')) });
  });
  await app.page.goto('https://linux.sb/gacha');
  const panel = app.page.locator('#linux-sb-title-assistant');
  await expect(panel.getByRole('alert')).toContainText('503');
  await app.page.locator('.gacha-actions button').click();
  await expect(panel.locator('.lsa-confirm')).toContainText('10 积分');
  points = 5;
  await panel.getByRole('button', { name: '确认抽取', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('积分不足');
  expect(submitted).toEqual([]);
  expect(app.errors).toEqual([]);
});
