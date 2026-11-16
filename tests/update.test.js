const test = require('node:test');
const assert = require('node:assert/strict');
const update = require('../lib/update');

test('compares Chrome extension versions by numeric parts', () => {
  assert.equal(update.compareVersions('0.12.2', '0.12.1'), 1);
  assert.equal(update.compareVersions('0.12.1', '0.12.1.0'), 0);
  assert.equal(update.compareVersions('0.12.0', '0.12.1'), -1);
  assert.equal(update.compareVersions('0.13.0', '0.12.99'), 1);
  assert.throws(() => update.compareVersions('v0.12.2', '0.12.1'), /版本号格式无效/);
});
