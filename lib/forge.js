(function (global) {
  'use strict';
  const STAGES = [
    { source: 'N', target: 'R', cost: 3, label: 'N → R' },
    { source: 'R', target: 'SR', cost: 3, label: 'R → SR' },
    { source: 'SR', target: 'SSR', cost: 8, label: 'SR → SSR' }
  ];
  function verifyStage(proof, inventory) {
    if (!proof || !Array.isArray(inventory)) return false;
    const count = (items, rarity, name) => items.filter(item => item.rarity === rarity && (name === undefined || item.name === name))
      .reduce((sum, item) => sum + Number(item.count || 0), 0);
    const stage = STAGES[proof.stageIndex];
    if (!stage || !proof.cycles || !proof.selected?.length || !Array.isArray(proof.before)) return false;
    const expected = new Map(proof.selected.map(item => [item.name, item.quantity]));
    if ([...expected.values()].reduce((a, b) => a + b, 0) !== proof.cycles * stage.cost) return false;
    const names = new Set([...proof.before, ...inventory].filter(item => item.rarity === stage.source).map(item => item.name));
    for (const name of names) {
      if (count(proof.before, stage.source, name) - count(inventory, stage.source, name) !== (expected.get(name) || 0)) return false;
    }
    return count(inventory, stage.target) - count(proof.before, stage.target) === proof.cycles;
  }
  const api = { STAGES, verifyStage };
  global.LinuxSbForge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
