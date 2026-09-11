const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => value === undefined ? undefined : structuredClone(value);
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

function extension(initial = {}) {
  const data = clone(initial);
  const listeners = [];
  const workers = [];
  const local = {
    async get(key) { return { [key]: clone(data[key]) }; },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
        changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
        data[key] = clone(value);
      }
      if (Object.keys(changes).length) queueMicrotask(() => listeners.forEach(fn => fn(clone(changes), 'local')));
    },
    async remove(key) { delete data[key]; }
  };
  const workerChrome = { storage: { local }, runtime: { onMessage: { addListener(fn) { workers.push(fn); } } } };
  const context = vm.createContext({ chrome: workerChrome, crypto, console });
  for (const file of ['lib/state.js', 'lib/forge.js', 'lib/store-worker.js']) vm.runInContext(source(file), context);
  function request(action, payload = {}, tabId = 1) {
    return new Promise((resolve, reject) => {
      const sender = { tab: { id: tabId, url: 'https://linux.sb/gacha_forge_center' } };
      workers[0]({ type: 'STATE', action, ...clone(payload) }, sender, response => {
        if (response.ok) resolve(clone(response.result)); else reject(new Error(response.error));
      });
    });
  }
  function dom(html, url = 'https://linux.sb/gacha', tabId = 1) {
    const instance = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const chrome = {
      storage: { local, onChanged: { addListener(fn) { listeners.push(fn); } } },
      runtime: {
        sendMessage: async message => {
          try { return { ok: true, result: await request(message.action, message, tabId) }; }
          catch (error) { return { ok: false, error: error.message }; }
        },
        onMessage: { addListener() {} }, openOptionsPage() {}
      },
      tabs: { query: async () => [{ id: tabId }], create() {} }
    };
    instance.window.chrome = chrome;
    instance.window.AbortSignal = global.AbortSignal;
    const evaluate = file => instance.window.eval(source(file));
    return { window: instance.window, document: instance.window.document, evaluate, close: () => instance.window.close() };
  }
  return { data, request, dom, local };
}
const accountBar = id => `<div class="bar-right"><a href="/user/${id}">我的账号</a></div>`;
const titles = [
  { name: '萌新', rarity: 'N', count: 7 }, { name: '常客', rarity: 'R', count: 1 },
  { name: '高手', rarity: 'SR', count: 1 }, { name: '欧皇', rarity: 'SSR', count: 1 }
];
function gacha(id = '1', points = 903) {
  return `${accountBar(id)}<main class="gacha-center-page"><div class="gacha-center-stat">积分 ${points} 称号 4 / 4</div>
    ${titles.map(t => `<div class="gacha-all-item"><span class="gacha-title-name">${t.name}</span><span class="gacha-title-rarity">${t.rarity}</span></div>`).join('')}
    <div class="gacha-actions"><form action="/gacha" method="post"><button data-cost="10">单抽</button></form></div></main>`;
}
function profile(id = '1', inventory = titles) {
  return `${accountBar(id)}<main><div class="gacha-center-stat">${inventory.length} 种称号</div>${inventory.map(t => `<article class="gacha-profile-item"><span class="gacha-title-name">${t.name}</span><span class="gacha-title-rarity">${t.rarity}</span><span class="gacha-profile-meta">×${t.count}</span></article>`).join('')}</main>`;
}
function forge(id = '1', inventory = titles) {
  return `${accountBar(id)}<main><div class="gacha-center-stat">积分 903</div>${['N', 'R', 'SR'].map(rarity => `<form action="/gacha_forge_center" method="post">
  ${inventory.filter(t => t.rarity === rarity).map((t, i) => `<article><span class="gacha-title-name">${t.name}</span><label><input type="checkbox" value="${rarity}-${i}" data-gacha-forge-rarity="${rarity.toLowerCase()}"><input type="number" min="1" max="${t.count}" value="1"></label></article>`).join('')}
  <input data-gacha-forge-count><button data-gacha-forge-source="${rarity}">熔铸</button></form>`).join('')}</main>`;
}
module.exports = { extension, source, tick, accountBar, titles, gacha, profile, forge };
