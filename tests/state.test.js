const test = require('node:test');
const assert = require('node:assert/strict');
const { extension } = require('../test-support/extension');
const state = require('../lib/state');
const { verifyStage } = require('../lib/forge');
const key = state.STORAGE_KEY;

test('image settings share defaults and never return upload credentials to content scripts', () => {
  assert.equal(state.imageSettings().compressionQuality, 0.84);
  const settings = state.imageSettings({ enabled: true, secretAccessKey: 'test-secret', accessKeyId: 'test-id', compressionQuality: 2, maxDimension: 1 });
  assert.equal(settings.secretAccessKey, undefined);
  assert.equal(settings.accessKeyId, undefined);
  assert.equal(settings.compressionQuality, 0.95);
  assert.equal(settings.maxDimension, 512);
});

test('migration preserves identified history and quarantines unknown legacy data', async () => {
  const old = { userId: '1', current: { points: 50 }, historyRows: [{ time: 't', reason: '抽卡', change: -10 }], settings: { forgeExcludedNames: ['路人甲'] } };
  const ext = extension({ [key]: old, pendingForgeChain: { stageIndex: 1 } });
  const migrated = await ext.request('GET');
  assert.equal(migrated.current.points, 50);
  assert.deepEqual(migrated.settings.forgeExcludedNames, ['路人甲']);
  assert.equal(ext.data.pendingForgeChain, undefined);
  assert.equal((await ext.request('GET', { userId: '2' })).historyRows.length, 0);
  const unknown = state.normalize({ ...old, userId: '' });
  assert.equal(unknown.activeUserId, '');
  assert.ok(unknown.unassignedLegacy);
  assert.deepEqual(unknown.accounts, {});
});

test('concurrent partial settings and account writes do not clobber one another', async () => {
  const ext = extension();
  await Promise.all([
    ext.request('SETTINGS', { patch: { forgeTarget: 'SSR', forgeKeepOne: false, forgeExcludedNames: ['萌新'] } }),
    ext.request('SETTINGS', { patch: { reservePoints: 300 } }),
    ext.request('SETTINGS', { patch: { adRemovalEnabled: true } }),
    ext.request('CURRENT', { userId: '1', current: { points: 900 } }),
    ext.request('CURRENT', { userId: '2', current: { points: 42 } })
  ]);
  const one = await ext.request('GET', { userId: '1' });
  const two = await ext.request('GET', { userId: '2' });
  assert.equal(one.current.points, 900);
  assert.equal(two.current.points, 42);
  assert.equal(one.settings.forgeTarget, 'SSR');
  assert.equal(one.settings.forgeKeepOne, false);
  assert.equal(one.settings.reservePoints, 300);
  assert.equal(one.settings.adRemovalEnabled, true);
  assert.deepEqual(one.settings.forgeExcludedNames, ['萌新']);
});

test('clear history invalidates old in-flight results without changing another account', async () => {
  const ext = extension();
  const row = { id: '1', time: 't', reason: '抽卡', change: -10 };
  await ext.request('HISTORY', { userId: '2', generation: 0, historyRows: [row] });
  await ext.request('CLEAR_HISTORY', { userId: '1' });
  await assert.rejects(ext.request('HISTORY', { userId: '1', generation: 0, historyRows: [row] }), /统计已被清除/);
  assert.equal((await ext.request('GET', { userId: '1' })).historyRows.length, 0);
  assert.equal((await ext.request('GET', { userId: '2' })).historyRows.length, 1);
});

test('merge preserves equal-time legitimate draws, deduplicates stable IDs and upgrades legacy records', () => {
  const row = { time: 't', reason: '抽卡', change: -10 };
  assert.equal(state.mergeRecords([row], [row, row]).length, 2);
  assert.equal(state.mergeRecords([row, row], [row]).length, 2);
  const identified = { ...row, id: 'abc' };
  assert.deepEqual(state.mergeRecords([row], [identified, identified]), [identified]);
  assert.equal(state.mergeRecords([], [identified, identified]).length, 1);
});

const before = [{ name: '萌新', rarity: 'N', count: 7 }, { name: '常客', rarity: 'R', count: 1 }];
const after = [{ name: '萌新', rarity: 'N', count: 1 }, { name: '常客', rarity: 'R', count: 3 }];
const proof = { stageIndex: 0, cycles: 2, before, selected: [{ name: '萌新', quantity: 6 }] };
test('forge validates exact material decrease and generated inventory increase', () => {
  assert.equal(verifyStage(proof, after), true);
  assert.equal(verifyStage(proof, before), false);
  assert.equal(verifyStage(proof, [{ ...after[0] }, { ...after[1], count: 2 }]), false);
  assert.equal(verifyStage(proof, [{ ...after[0], count: 0 }, after[1]]), false);
});

test('forge has exclusive tab ownership, does not advance on submission, verifies after navigation and honors stop', async () => {
  const ext = extension();
  const task = await ext.request('FORGE_START', { userId: '1', targetRarity: 'SSR' }, 10);
  await assert.rejects(ext.request('FORGE_START', { userId: '1' }, 20), /已有熔铸任务/);
  await assert.rejects(ext.request('FORGE_STEP', { userId: '1', id: task.id, documentToken: 'a', proof }, 20), /其他标签页/);
  const submitted = await ext.request('FORGE_STEP', { userId: '1', id: task.id, documentToken: 'a', proof }, 10);
  assert.equal(submitted.stageIndex, 0);
  assert.equal(submitted.phase, 'awaiting');
  await assert.rejects(ext.request('FORGE_STEP', { userId: '1', id: task.id, documentToken: 'a', inventory: after }, 10), /等待站点/);
  await assert.rejects(ext.request('FORGE_STEP', { userId: '1', id: task.id, documentToken: 'b', inventory: before }, 10), /未能确认/);
  assert.equal((await ext.request('FORGE_GET', { userId: '1' }, 20)).ownedByTab, false);
  const verified = await ext.request('FORGE_STEP', { userId: '1', id: task.id, documentToken: 'b', inventory: after }, 10);
  assert.equal(verified.stageIndex, 1);
  assert.equal(verified.phase, 'ready');
  await ext.request('FORGE_STOP', { userId: '1', id: task.id });
  await assert.rejects(ext.request('FORGE_STEP', { userId: '1', id: task.id, stageIndex: 1, skip: true }, 10), /已停止/);
  assert.equal(await ext.request('FORGE_GET', { userId: '2' }), null);
});
