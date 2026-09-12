const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const parser = require('../lib/parser');

test('draw prices use the clicked control and explicit displayed fees', () => {
  const dom = new JSDOM(`<form>
    <button name="mode" value="single" data-cost="10">抽一次 (10 积分)</button>
    <button name="mode" value="ten">十连抽（<span>90</span> 积分）</button>
    <input type="submit" value="百连抽（800 积分）">
    <button type="button">其他操作（999 积分）</button>
  </form>`);
  try {
    const form = dom.window.document.querySelector('form');
    const [single, ten, hundred, other] = form.elements;
    assert.equal(parser.parseDrawAction(form, single).cost, 10);
    assert.equal(parser.parseDrawAction(form, ten).cost, 90);
    assert.equal(parser.parseDrawAction(form, hundred).cost, 800);
    assert.equal(parser.parseDrawAction(form, ten).button, ten);
    assert.equal(parser.parseDrawAction(form, other), null);
    assert.equal(parser.parseDrawAction(form), null, 'Multiple submit buttons need an explicit submitter');
  } finally { dom.window.close(); }
});

test('unknown, contradictory and invalid draw fees cannot silently use a default cost', () => {
  for (const markup of [
    '<button>十连抽</button>', '<button data-cost="no-price">百连抽</button>',
    '<button data-cost="10">十连抽（90 积分）</button>',
    '<button data-cost="">抽一次</button>', '<button>抽一次（-10 积分）</button>',
    '<button data-cost="10">今日免费一抽</button>',
    '<button data-cost="0">抽一次（10 积分）</button>',
    '<button>抽一次（10 积分 / 20 积分）</button>'
  ]) {
    const dom = new JSDOM(`<form>${markup}</form>`);
    try { assert.equal(parser.parseDrawAction(dom.window.document.querySelector('form')), null, markup); }
    finally { dom.window.close(); }
  }
  const dom = new JSDOM('<form><button data-cost="10">抽一次</button></form><form><button>百连抽 (1,200 积分)</button></form>');
  try {
    const [first, second] = dom.window.document.forms;
    assert.equal(parser.parseDrawAction(first).cost, 10);
    assert.equal(parser.parseDrawAction(second).cost, 1200, 'Use the published price, not a hardcoded hundred-draw cost');
    assert.equal(parser.parseDrawAction(first, second.querySelector('button')), null);
  } finally { dom.window.close(); }
});

test('explicit free draws and zero fees are recognized without treating missing fees as free', () => {
  for (const markup of [
    '<button>今日免费一抽</button>', '<button>每日免费一抽</button>',
    '<button>免费一抽（0 积分）</button>', '<button data-cost="0">今日免费一抽</button>',
    '<button data-cost="0">抽一次</button>', '<button>抽一次（0 积分）</button>'
  ]) {
    const dom = new JSDOM(`<form>${markup}</form>`);
    try { assert.equal(parser.parseDrawAction(dom.window.document.querySelector('form'))?.cost, 0, markup); }
    finally { dom.window.close(); }
  }
});
