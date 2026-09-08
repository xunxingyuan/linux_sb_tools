const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../lib/parser.js');

test('classifies title point history reasons', () => {
  assert.deepEqual(parser.classifyHistoryReason('百连抽:称号系统'), { kind: 'draw', mode: 'hundred', pulls: 100 });
  assert.deepEqual(parser.classifyHistoryReason('十连抽:称号系统'), { kind: 'draw', mode: 'ten', pulls: 10 });
  assert.deepEqual(parser.classifyHistoryReason('抽卡:称号系统'), { kind: 'draw', mode: 'single', pulls: 1 });
  assert.equal(parser.classifyHistoryReason('每日签到').kind, 'other');
});

test('summarizes draw, recycle, sale and purchase history', () => {
  const summary = parser.summarizeHistory([
    { kind: 'draw', mode: 'hundred', pulls: 100, change: -800, time: '2026-09-08T10:00:00+08:00' },
    { kind: 'draw', mode: 'ten', pulls: 10, change: -90, time: '2026-09-08T09:00:00+08:00' },
    { kind: 'recycle', change: 200, time: '2026-09-08T08:00:00+08:00' },
    { kind: 'sell', change: 280, time: '2026-09-08T07:00:00+08:00' },
    { kind: 'buy', change: -208, time: '2026-09-08T06:00:00+08:00' }
  ]);
  assert.equal(summary.totalPulls, 110);
  assert.equal(summary.totalSpend, 890);
  assert.equal(summary.recyclePoints, 200);
  assert.equal(summary.sellPoints, 280);
  assert.equal(summary.purchasePoints, 208);
  assert.equal(summary.netGachaPoints, -618);
  assert.equal(summary.firstTime, '2026-09-08T06:00:00+08:00');
  assert.equal(summary.lastTime, '2026-09-08T10:00:00+08:00');
});

test('keeps draw counts and point costs aligned by draw mode', () => {
  const rows = [
    ...Array.from({ length: 38 }, () => ({ kind: 'draw', mode: 'hundred', pulls: 100, change: -800 })),
    ...Array.from({ length: 18 }, () => ({ kind: 'draw', mode: 'ten', pulls: 10, change: -90 })),
    { kind: 'draw', mode: 'single', pulls: 1, change: -10 }
  ];
  const summary = parser.summarizeHistory(rows);
  assert.equal(summary.totalPulls, 3981);
  assert.equal(summary.totalSpend, 32030);
  assert.deepEqual(summary.byMode, {
    single: { batches: 1, pulls: 1, cost: 10 },
    ten: { batches: 18, pulls: 180, cost: 1620 },
    hundred: { batches: 38, pulls: 3800, cost: 30400 }
  });
});

test('plans discounted pulls while preserving the requested reserve', () => {
  const plan = parser.planDraws(903, 0);
  assert.deepEqual(plan.plan.map((item) => [item.mode, item.count]), [['single', 1], ['ten', 1], ['hundred', 1]]);
  assert.equal(plan.totalPulls, 111);
  assert.equal(plan.totalCost, 900);
  assert.equal(plan.remaining, 3);

  const protectedPlan = parser.planDraws(903, 100);
  assert.equal(protectedPlan.totalCost, 800);
  assert.equal(protectedPlan.remaining, 103);
});

test('computes newly obtained inventory entries', () => {
  const changes = parser.diffInventory(
    [{ name: '欧皇', rarity: 'SSR', count: 4 }, { name: '常客', rarity: 'R', count: 1 }],
    [{ name: '欧皇', rarity: 'SSR', count: 5 }, { name: '常客', rarity: 'R', count: 1 }, { name: '富可敌国', rarity: 'SSR', count: 1 }]
  );
  assert.deepEqual(changes.map((item) => [item.name, item.count]), [['欧皇', 1], ['富可敌国', 1]]);
});

test('parses current points from a simple text document', () => {
  const body = { textContent: '主题 回帖 积分 903 我的称号' };
  assert.equal(parser.parseCurrentPoints({ body, querySelectorAll: () => [] }), 903);
});

test('parses forge output as a separate probabilistic event', () => {
  const event = parser.parseForgeNotification('你消耗了 16 个 SR 称号，批量熔炼获得 2 个 SSR：氪金大佬 ×1、欧皇 ×1。');
  assert.equal(event.kind, 'forge');
  assert.equal(event.inputRarity, 'SR');
  assert.equal(event.inputCount, 16);
  assert.equal(event.outputRarity, 'SSR');
  assert.deepEqual(event.outcomes.map((item) => [item.name, item.count]), [['氪金大佬', 1], ['欧皇', 1]]);
});

test('scores the forge gradient independently', () => {
  const score = parser.scoreForgeProfile({
    forgeEvents: [
      { inputCount: 400, outputCount: 50, outputRarity: 'SSR', outcomes: [{ name: '富可敌国', rarity: 'SSR', count: 50 }] }
    ]
  });
  assert.equal(score.forgeBand.label, '天选之子');
  assert.equal(score.forgeBand.description, '命运主动给你让路');
});

test('scores SSR forge results without mixing lower-tier forge outputs', () => {
  const summary = parser.summarizeForgeEvents([
    { inputCount: 3, outputCount: 1, outputRarity: 'R', outcomes: [{ name: '常客', rarity: 'R', count: 1 }] },
    { inputCount: 8, outputCount: 1, outputRarity: 'SSR', outcomes: [{ name: '富可敌国', rarity: 'SSR', count: 1 }] }
  ]);
  assert.deepEqual(summary.byOutputRarity, { UR: 0, SSR: 1, SR: 0, R: 1, N: 0 });
  assert.deepEqual(summary.ranked.map((item) => item.name), ['富可敌国']);
  assert.equal(summary.ssrOutputs, 1);
});

test('provides the six requested score bands', () => {
  assert.deepEqual(
    [100, 80, 65, 50, 25, 5].map((value) => parser.scoreBand(value).label),
    ['天选之子', '欧气成精', '锦鲤转世', '随机路人', '保底受害者', '非酋降临']
  );
  assert.equal(parser.scoreBand(null).label, '评价待记录');
});

test('plans forge materials with the safe defaults', () => {
  const plan = parser.planForgeMaterials([
    { name: '路人甲', available: 121 },
    { name: '打酱油的', available: 1 },
    { name: '萌新', available: 5 }
  ], { sourceRarity: 'N', cost: 3, excludeRoad: true, keepOne: true });
  assert.equal(plan.totalUsable, 4);
  assert.equal(plan.materialToUse, 3);
  assert.equal(plan.cycles, 1);
  assert.deepEqual(plan.rows.map((row) => [row.name, row.usable, row.selectedQuantity]), [
    ['路人甲', 0, 0],
    ['打酱油的', 0, 0],
    ['萌新', 4, 3]
  ]);
});

test('supports manually added forge exclusions', () => {
  const plan = parser.planForgeMaterials([
    { name: '萌新', available: 8 },
    { name: '潜水员', available: 5 },
    { name: '路人甲', available: 10 }
  ], { sourceRarity: 'N', cost: 3, excludedNames: ['路人甲', '萌新'], keepOne: false });
  assert.equal(plan.totalUsable, 5);
  assert.equal(plan.materialToUse, 3);
  assert.deepEqual(plan.rows.map((row) => [row.name, row.usable, row.selectedQuantity]), [
    ['萌新', 0, 0],
    ['潜水员', 5, 3],
    ['路人甲', 0, 0]
  ]);
});
