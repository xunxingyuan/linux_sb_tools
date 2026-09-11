const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gacha, profile, accountBar } = require('../test-support/extension');
const root = path.resolve(__dirname, '..');
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
    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
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
  await settings.locator('#adRemovalEnabled').check();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(settings.locator('#message')).toHaveText('设置已保存。');
  const accountBox = await settings.locator('#accountLabel').boundingBox();
  const settingsButtons = await settings.locator('#settingsForm > .button-row').boundingBox();
  expect(accountBox.y + accountBox.height).toBeLessThanOrEqual(settingsButtons.y);
  const popup = await app.context.newPage();
  await popup.setViewportSize({ width: 360, height: 620 });
  await popup.goto(`chrome-extension://${app.id}/popup.html`);
  await expect(popup.locator('#adRemovalEnabled')).toBeChecked();
  await expect(popup.locator('.page-grid button')).toHaveCount(3);
  await expect(popup.locator('.utility-row')).toBeVisible();
  await popup.screenshot({ path: path.join(root, 'docs/screenshots/popup-simplified.png'), fullPage: true });
  await popup.locator('#adRemovalEnabled').uncheck();
  await expect(popup.locator('#status')).toHaveText('设置已保存');
  const saved = await app.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], titleStateKey);
  expect(saved.settings.reservePoints).toBe(250);
  expect(saved.settings.forgeTarget).toBe('SSR');
  expect(saved.settings.adRemovalEnabled).toBe(false);
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

test('image helper mounts from shared settings and removes itself when disabled', async ({ app }) => {
  await app.page.goto('https://linux.sb/topic/1');
  await expect(app.page.locator('#linux-sb-image-host')).toHaveCount(0);
  await app.worker.evaluate(async () => chrome.storage.local.set({ linuxSbImageHostConfig: { enabled: true, provider: 'cloudflare-r2' } }));
  await expect(app.page.locator('#linux-sb-image-host')).toBeVisible();
  await app.worker.evaluate(async () => chrome.storage.local.set({ linuxSbImageHostConfig: { enabled: false } }));
  await expect(app.page.locator('#linux-sb-image-host')).toHaveCount(0);
  expect(app.errors).toEqual([]);
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
