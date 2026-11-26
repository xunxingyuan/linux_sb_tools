const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const points = require('../lib/points');
const parser = require('../lib/parser');
const state = require('../lib/state');
const { extension, source, tick, accountBar, gacha } = require('../test-support/extension');
const key = state.STORAGE_KEY;
const scripts = ['lib/state.js', 'lib/parser.js', 'lib/history.js', 'lib/points.js', 'lib/points-sync.js', 'lib/market.js', 'lib/points-chart.js', 'lib/points-insights.js', 'points.js'];
const pointHtml = (rows, next = '') => `${accountBar('1')}<main>${rows.length ? rows.map(row => `<div class="points-rewards-detail" data-id="${row.id}"><span class="points-rewards-reason">${row.reason}</span><span class="points-rewards-change-value">${row.change}</span><time class="points-rewards-time" datetime="${row.time}"></time></div>`).join('') : '<p>暂无记录</p>'}${next}</main>`;
const now = points.dayKey(new Date());
const sample = [
  { id: 'a', reason: '每日签到', change: 20, time: `${now} 09:30:00` },
  { id: 'b', reason: '领取红包', change: 100, time: `${now} 10:30:00` },
  { id: 'c', reason: '抽卡:称号系统', change: -10, time: `${now} 11:30:00`, kind: 'draw', pulls: 1, mode: 'single' },
  { id: 'd', reason: '发布红包', change: -50, time: `${now} 12:30:00` },
  { id: 'e', reason: '未知新类型奖励', change: 7, time: `${now} 13:30:00` }
];

test('all-point parser preserves every type, including zero/unknown amounts; title parser remains scoped', () => {
  const doc = new JSDOM(pointHtml([...sample.map(row => ({ ...row, change: row.change > 0 ? `+${row.change}` : row.change })),
    { id: 'zero', reason: '免费抽卡:称号系统', change: '+0', time: now },
    { id: 'invalid', reason: '系统调整', change: '未知', time: now }])).window.document;
  const all = parser.parseAllPointsHistoryPage(doc);
  assert.equal(all.length, 7);
  assert.equal(all.at(-1).change, null);
  assert.equal(parser.parsePointsHistoryPage(doc).length, 2);
  const rows = points.records(all);
  assert.equal(rows[0].category, '每日签到');
  assert.equal(rows[4].category, '待分类');
  assert.deepEqual(points.summary(rows), { income: 127, expense: 60, net: 67, count: 7, invalid: 1, undated: 0 });
});

test('day/week buckets use UTC+8, Monday starts, missing days and partial weeks across year boundaries', () => {
  assert.equal(points.dayKey('2026-12-31T16:30:00Z'), '2027-01-01');
  assert.equal(points.dayKey('2026-11-26 23:59:00'), '2026-11-26');
  assert.equal(points.dayKey('2026-02-30'), '');
  assert.equal(points.dayKey('刚刚'), '');
  const rows = points.records([
    { time: '2026-12-31T16:30:00Z', reason: '签到', change: 10 },
    { time: '2027-01-04', reason: '红包', change: -40 },
    { time: '2027-01-05', reason: '红包', change: 99 }
  ]);
  const weekly = points.buckets(rows, { start: '2027-01-01', end: '2027-01-04', mode: 'week' });
  assert.equal(weekly.length, 2);
  assert.deepEqual(weekly.map(row => [row.key, row.start, row.end, row.income, row.expense]), [
    ['2026-12-28', '2027-01-01', '2027-01-03', 10, 0], ['2027-01-04', '2027-01-04', '2027-01-04', 0, 40]
  ]);
  const daily = points.buckets(rows, { start: '2027-01-01', end: '2027-01-04' });
  assert.equal(daily.length, 4); assert.equal(daily[1].income, 0);
  assert.deepEqual(points.buckets(rows, { start: '2027-01-05', end: '2027-01-01' }), []);
});

test('actual forum reason templates have distinct precise types and reversal directions', () => {
  const cases = [
    ['每日首个主帖奖励', 460, '每日首帖奖励'], ['每日首个回帖奖励', 94, '每日首回帖奖励'],
    ['抢沙发奖励', 90, '抢沙发奖励'], ['互动奖励', 90, '互动奖励'],
    ['帖子删除退回互动奖励', -90, '互动奖励扣回'],
    ['帖子移动至无奖励版块退回发帖奖励', -83, '发帖奖励扣回'],
    ['帖子移动至无奖励版块退回互动奖励', -90, '互动奖励扣回'],
    ['回复红包帖领取积分', 12, '回复红包领取'], ['审核认可回复，领取红包积分', 100, '讨论红包审核领取'],
    ['每日首次显示侧边栏广告奖励', 472, '侧边栏广告奖励'], ['每日有奖广告抽奖', 439, '有奖广告抽奖'],
    ['用户「测试用户」打赏了你的主题', 6, '收到主题打赏'], ['给用户「测试用户」的主题打赏', -6, '送出主题打赏'],
    ['幸运打赏奖励', 3465, '幸运打赏奖励'], ['兑换虚拟卡“流量兑换码”', -1, '虚拟卡兑换'],
    ['购买称号「管理员之友」×1', -235, '称号购买'], ['出售称号「隐藏大佬」×1', 450, '称号出售'],
    ['SSR 回收:称号系统', 400, 'SSR 称号回收'], ['SR 回收:称号系统', 40, 'SR 称号回收'],
    ['抽卡:称号系统', -10, '称号单抽'], ['十连抽:称号系统', -90, '称号十连抽'], ['百连抽:称号系统', -800, '称号百连抽'],
    ['每日首次隐藏侧边栏广告奖励', 189, '每日隐藏广告奖励'], ['首次隐藏侧边栏广告奖励', 54, '首次隐藏广告奖励'],
    ['飞刀大乱斗击杀奖励', 12, '飞刀大乱斗击杀奖励'], ['精华竞猜奖池结算奖励', 20, '精华竞猜奖池结算'],
    ['社区搜索（全部内容）', -1, '站内搜索费用'], ['讨论红包认可返现', 80, '讨论红包认可返现'],
    ['上传本地头像', -50, '本地头像上传'], ['帖子被评为精华', 200, '精华奖励'],
    ['发布红包帖，积分托管', -500, '红包积分托管'], ['身份鉴定费（创作者）', -100, '身份鉴定费用'],
    ['回复挖坟扣积分（超过30天）', -300, '挖坟回复扣分'], ['编辑主帖', -81, '编辑主帖扣费'],
    ['主题《红包广告称号中奖交流》中的回帖收到投币', 10, '回帖投币收入']
  ];
  for (const [reason, change, expected] of cases) {
    const c = points.classify({ reason, change });
    assert.equal(c.label, expected, reason); assert.equal(c.status, '已识别', reason);
  }
});

test('classification cannot be redirected by usernames, title names or linked topic titles; ambiguous data is flagged', () => {
  for (const name of ['称号', '管理员', '红包', '每日签到', '广告抽奖']) {
    assert.equal(points.category({ reason: `用户「${name}」打赏了你的主题`, change: 99 }), '收到主题打赏');
    assert.equal(points.category({ reason: `购买称号「${name}」×1`, change: -99 }), '称号购买');
  }
  assert.equal(points.classify({ reason: '购买称号「红包」×1', change: 100 }).status, '方向待核对');
  assert.equal(points.classify({ reason: '帖子删除退回互动奖励', change: -90 }).status, '已识别');
  assert.equal(points.classify({ reason: '打赏', change: 99 }).status, '来源待识别');
  assert.equal(points.classify({ reason: '广告相关积分', change: -20 }).label, '待分类');
  assert.equal(points.classify({ reason: '每日签到', change: null }).status, '金额待识别');
  const doc = new JSDOM(`${accountBar('1')}<main><div class="points-rewards-detail"><div class="points-rewards-reason">互动奖励</div><a href="/topic/20">红包广告称号交易</a><span class="points-rewards-change-value">+90</span><time class="points-rewards-time" datetime="${now}"></time></div></main>`).window.document;
  const row = parser.parseAllPointsHistoryPage(doc)[0];
  assert.equal(row.reason, '互动奖励'); assert.equal(row.relatedTitle, '红包广告称号交易');
  assert.equal(row.relatedUrl, 'https://linux.sb/topic/20'); assert.equal(points.category(row), '互动奖励');
});

test('people ranking separates incoming/outgoing tips and excludes system, packet and bonus rewards', () => {
  const rows = points.records([
    { reason: '用户「甲」打赏了你的主题', change: 100 },
    { reason: '用户「甲」打赏了你的回复', change: 40 },
    { reason: '用户「乙」打赏了你的主题', change: 80 },
    { reason: '给用户「甲」的主题打赏', change: -30 },
    { reason: '给用户「丙」的回复打赏', change: -90 },
    { reason: '幸运打赏奖励', change: 5000 },
    { reason: '每日签到', change: 300 }, { reason: '回复红包帖领取积分', change: 100 },
    { reason: '收到打赏', change: 20 }, { reason: '用户「甲」打赏了你的主题', change: -10 }
  ]);
  const incoming = points.people(rows, 'income'), outgoing = points.people(rows, 'expense');
  assert.deepEqual(incoming.leaders, [{ name: '甲', amount: 140, count: 2 }, { name: '乙', amount: 80, count: 1 }]);
  assert.equal(incoming.amount, 220); assert.equal(incoming.unattributedCount, 1); assert.equal(incoming.unattributedAmount, 20);
  assert.deepEqual(outgoing.leaders, [{ name: '丙', amount: 90, count: 1 }, { name: '甲', amount: 30, count: 1 }]);
  assert.equal(outgoing.unattributedAmount, 10);
  assert.equal(rows.at(-1).counterparty, null);
  const names = points.people(points.records([{ reason: '用户「Ａ」打赏了你的主题', change: 1 }, { reason: '用户「A」打赏了你的主题', change: 2 }]), 'income');
  assert.equal(names.leaders.length, 2, 'different displayed nicknames must not be merged by Unicode normalisation');
});

test('topic ranking groups reply URLs by topic id and requires a trustworthy topic link', () => {
  const rows = points.records([
    { reason: '互动奖励', change: 90, relatedUrl: 'https://linux.sb/topic/10?replyid=1', relatedTitle: '测试主题' },
    { reason: '回复红包帖领取积分', change: 40, relatedUrl: 'https://linux.sb/topic/10?replyid=2', relatedTitle: '测试主题' },
    { reason: '给用户「甲」的主题打赏', change: -30, relatedUrl: 'https://linux.sb/topic/10', relatedTitle: '测试主题' },
    { reason: '每日签到', change: 1000, relatedTitle: '没有链接的标题' },
    { reason: '用户「甲」打赏了你的主题', change: 500, relatedUrl: 'https://elsewhere.test/topic/10' },
    { reason: '幸运打赏奖励', change: 4356, relatedUrl: 'https://linux.sb/topic/10', relatedTitle: '测试主题' },
    { reason: '幸运打赏奖励', change: 4554, relatedUrl: 'https://linux.sb/topic/11', relatedTitle: '仅有幸运打赏的主题' }
  ]);
  assert.deepEqual(points.topics(rows), [{ id: '10', url: 'https://linux.sb/topic/10', title: '测试主题', amount: 130, count: 2 }]);
  assert.equal(points.isTopicIncome(rows[5]), false);
  assert.equal(points.isTopicIncome(rows[6]), false);
  assert.equal(points.summary(rows).income, 10540, 'lucky bonuses remain in overall income');
});

test('activity includes quiet days in averages; composition includes all recognised and unknown amounts', () => {
  const rows = points.records([
    { reason: '每日签到', change: 100, time: '2026-11-20' },
    { reason: '抽卡:称号系统', change: -10, time: '2026-11-20' },
    { reason: '未知来源', change: 50, time: '2026-11-22' },
    { reason: '未知来源', change: null, time: '2026-11-22' }
  ]);
  const activity = points.activity(rows, { start: '2026-11-20', end: '2026-11-26' });
  assert.equal(activity.activeDays, 2); assert.equal(activity.dayCount, 7); assert.equal(activity.averageNet, 20);
  assert.equal(activity.bestDay.day, '2026-11-20'); assert.equal(activity.days[1].count, 2);
  assert.equal(points.composition(rows, 'income').total, 150);
  assert.equal(points.composition(rows, 'expense').total, 10);
  assert.equal(points.composition(rows, 'income').segments.some(segment => segment.name === '待分类'), true);
});

test('upgrading title-only complete history performs a full scan, then incremental sync is safe', async () => {
  // This is an actual pre-points schema: the stored account lacks pointsRows entirely.
  const ext = extension({ [key]: { version: 2, activeUserId: '1', accounts: { '1': {
    current: { points: 123 }, historyGeneration: 0, historyRows: [sample[2]], forgeEvents: [], sync: { historyRows: { complete: true } }
  } } } });
  const dom = ext.dom('<main></main>');
  for (const file of scripts.slice(0, 5)) dom.evaluate(file);
  const visited = [];
  const fetchPage = async url => {
    const page = Number(new URL(url).searchParams.get('p')); visited.push(page);
    const rows = page === 1 ? [sample[2]] : sample.filter(row => row.id !== 'c');
    return new JSDOM(pointHtml(rows.map(row => ({ ...row, change: row.change >= 0 ? `+${row.change}` : row.change })), '<a href="?tab=points_rewards&p=2">2</a>')).window.document;
  };
  const initial = await ext.request('GET', { userId: '1' });
  const result = await dom.window.LinuxSbPointsSync.collect({ snapshot: initial, fetchPage });
  assert.deepEqual(visited, [1, 2]);
  await ext.request('HISTORY', { userId: '1', generation: 0, ...JSON.parse(JSON.stringify(result)) });
  const saved = await ext.request('GET', { userId: '1' });
  assert.equal(saved.pointsRows.length, 5); assert.equal(saved.historyRows.length, 1);
  visited.length = 0;
  await dom.window.LinuxSbPointsSync.collect({ snapshot: saved, fetchPage });
  assert.deepEqual(visited, [1]);
  await ext.request('CLEAR_HISTORY', { userId: '1' });
  await assert.rejects(ext.request('HISTORY', { userId: '1', generation: 0, pointsRows: sample }), /统计已被清除/);
  assert.equal((await ext.request('GET', { userId: '1' })).pointsRows.length, 0);
  dom.close();
});

test('statistics page filters raw reasons, directions and account-isolated data; errors preserve old rows', async t => {
  const ext = extension();
  await ext.request('CURRENT', { userId: '2', current: { points: 22 } });
  await ext.request('CURRENT', { userId: '1', current: { points: 1000 } });
  await ext.request('HISTORY', { userId: '1', generation: 0, pointsRows: sample, sync: { pointsRows: { complete: true, updatedAt: new Date().toISOString() } } });
  const dom = ext.dom(source('points.html'), 'https://extension.test/points.html?account=1'); t.after(dom.close);
  dom.window.fetch = async () => ({ ok: true, text: async () => gacha('2') });
  scripts.forEach(dom.evaluate); await tick();
  const $ = id => dom.document.getElementById(id);
  assert.equal($('income').textContent, '127'); assert.equal($('expense').textContent, '60');
  assert.equal($('ledgerRows').children.length, 5);
  $('search').value = '红包'; $('search').dispatchEvent(new dom.window.Event('input'));
  assert.equal($('ledgerRows').children.length, 2);
  $('direction').value = 'expense'; $('direction').dispatchEvent(new dom.window.Event('change'));
  assert.equal($('ledgerRows').children.length, 1); assert.match($('filteredTotals').textContent, /消耗 50/);
  $('syncPoints').click(); await tick(); await tick();
  assert.match($('message').textContent, /统计账号 1 不同/);
  assert.equal((await ext.request('GET', { userId: '1' })).pointsRows.length, 5);
  $('account').value = '2'; $('account').dispatchEvent(new dom.window.Event('change')); await tick();
  assert.equal($('balance').textContent, '22'); assert.equal($('ledgerRows').children.length, 0);
});

test('standalone points page syncs without a forum tab and stores all types without polluting title metrics', async t => {
  const ext = extension();
  const dom = ext.dom(source('points.html'), 'https://extension.test/points.html'); t.after(dom.close);
  dom.window.fetch = async url => ({ ok: true, text: async () => String(url).includes('/gacha') ? gacha('1', 999)
    : pointHtml(sample.map(row => ({ ...row, change: row.change > 0 ? `+${row.change}` : row.change }))) });
  scripts.forEach(dom.evaluate); await tick();
  dom.document.getElementById('syncPoints').click(); await tick(); await tick();
  const saved = await ext.request('GET', { userId: '1' });
  assert.equal(saved.current.points, 999);
  assert.equal(saved.pointsRows.length, 5); assert.equal(saved.historyRows.length, 1);
  assert.equal(saved.sync.pointsRows.complete, true);
  assert.match(dom.document.getElementById('message').textContent, /同步完成/);
});

test('popup day/week chart sits above market and switches granularity without opening a tab', async t => {
  const ext = extension();
  await ext.request('CURRENT', { userId: '1', current: { points: 1000 } });
  await ext.request('HISTORY', { userId: '1', generation: 0, pointsRows: sample });
  const dom = ext.dom(source('popup.html'), 'https://extension.test/popup.html'); t.after(dom.close);
  ['lib/state.js', 'lib/parser.js', 'lib/points.js', 'lib/points-chart.js', 'popup.js'].forEach(dom.evaluate); await tick();
  assert.equal(dom.document.querySelector('.market-monitor').previousElementSibling.className, 'points-preview');
  assert.equal(dom.document.querySelectorAll('.points-bar-group').length, 7);
  dom.document.querySelector('[data-mode="week"]').click();
  assert.equal(dom.document.querySelectorAll('.points-bar-group').length, 8);
  assert.equal(dom.window.__createdTabs, undefined);
  assert.match(dom.document.getElementById('openPoints').getAttribute('href'), /mode=week&account=1/);
});

test('automatic account selection can sync a newly signed-in account while preserving previously cached accounts', async t => {
  const ext = extension();
  await ext.request('CURRENT', { userId: '1', current: { points: 111 } });
  await ext.request('HISTORY', { userId: '1', generation: 0, pointsRows: sample });
  const dom = ext.dom(source('points.html'), 'https://extension.test/points.html?account=1'); t.after(dom.close);
  dom.window.fetch = async url => ({ ok: true, text: async () => String(url).includes('/gacha') ? gacha('2', 222) : pointHtml([]).replace('/user/1', '/user/2') });
  scripts.forEach(dom.evaluate); await tick();
  const $ = id => dom.document.getElementById(id);
  assert.equal($('account').options.length, 2);
  $('account').value = ''; $('account').dispatchEvent(new dom.window.Event('change')); await tick();
  assert.equal($('account').value, '');
  $('syncPoints').click(); await tick(); await tick();
  assert.match($('message').textContent, /同步完成/);
  assert.equal((await ext.request('GET', { userId: '1' })).pointsRows.length, 5);
  assert.equal((await ext.request('GET', { userId: '2' })).current.points, 222);
  assert.equal($('account').options.length, 3);
});

test('old background protocol keeps account/date UI usable and offers an explicit extension reload', async t => {
  const ext = extension();
  await ext.request('CURRENT', { userId: '1', current: { points: 123 } });
  const dom = ext.dom(source('points.html'), 'https://extension.test/points.html?account=1'); t.after(dom.close);
  const original = dom.window.chrome.runtime.sendMessage;
  dom.window.chrome.runtime.sendMessage = async message => {
    if (message.action === 'ACCOUNTS') throw new Error('must not call the incompatible account endpoint');
    const response = await original(message); delete response.result.pointsProtocol; return response;
  };
  scripts.forEach(dom.evaluate); await tick();
  const $ = id => dom.document.getElementById(id);
  assert.equal($('account').options.length, 2); assert.ok($('startDate').value);
  assert.match($('message').textContent, /后台尚未加载新版积分接口/);
  assert.equal($('reloadExtension').hidden, false);
  $('reloadExtension').click(); assert.equal(dom.window.__reloadCount, 1);
});

test('dashboard replaces source audit with drillable people, topic and activity charts', async t => {
  const ext = extension();
  const entries = [
    { id: '1', reason: '用户「甲」打赏了你的主题', change: 100, time: now, relatedTitle: '测试主题', relatedUrl: 'https://linux.sb/topic/10?replyid=1' },
    { id: '2', reason: '用户「甲」打赏了你的回复', change: 40, time: now, relatedTitle: '测试主题', relatedUrl: 'https://linux.sb/topic/10?replyid=2' },
    { id: '3', reason: '给用户「乙」的主题打赏', change: -30, time: now },
    { id: '4', reason: '每日签到', change: 300, time: now },
    { id: '5', reason: '幸运打赏奖励', change: 1000, time: now, relatedTitle: '测试主题', relatedUrl: 'https://linux.sb/topic/10' },
    { id: '6', reason: '用户「丙」打赏了你的主题', change: 10, time: points.addDays(now, -50) }
  ];
  await ext.request('CURRENT', { userId: '1', current: { points: 2000 } });
  await ext.request('HISTORY', { userId: '1', generation: 0, pointsRows: entries });
  const dom = ext.dom(source('points.html'), 'https://extension.test/points.html?account=1'); t.after(dom.close);
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  scripts.forEach(dom.evaluate); await tick();
  const $ = id => dom.document.getElementById(id);
  assert.equal($('sourceTitle'), null); assert.equal($('sourceDetails'), null);
  assert.match($('receivedSummary').textContent, /1 位用户 · 2 笔 · 140 分/);
  assert.match($('sentSummary').textContent, /1 位用户 · 1 笔 · 30 分/);
  assert.equal($('trendChart').querySelector('svg').style.height, '212px');
  $('receivedPeople').querySelector('button').click();
  assert.equal($('ledgerRows').children.length, 2); assert.match($('insightFilterLabel').textContent, /甲/);
  $('clearInsightFilter').click(); assert.equal($('ledgerRows').children.length, 5);
  $('topicRanking').querySelector('button').click(); assert.equal($('ledgerRows').children.length, 2);
  $('resetFilters').click();
  $('presets').querySelector('[data-days="7"]').click();
  assert.equal($('activityCalendar').querySelectorAll('.calendar-day').length, 7);
  $('activityCalendar').querySelector(`[data-day="${now}"]`).click(); assert.equal($('ledgerRows').children.length, 5);
  $('presets').querySelector('[data-days="all"]').click();
  assert.match($('receivedSummary').textContent, /2 位用户 · 3 笔 · 150 分/);
});
