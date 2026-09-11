const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const parser = require('../lib/parser');
const { collectPages } = require('../lib/history');
const { recordKey } = require('../lib/state');
const { accountBar } = require('../test-support/extension');
const firstUrl = 'https://linux.sb/user/1?tab=points_rewards&p=1';

test('discovers hidden pagination from subsequent pages and avoids duplicate first-page fetch', async () => {
  const visited = [];
  const result = await collectPages({
    firstUrl,
    fetchPage: async url => { const page = Number(new URL(url).searchParams.get('p')); visited.push(page); return page; },
    parsePage: page => [{ id: String(page) }],
    pageUrls: page => [firstUrl.replace('p=1', `p=${page < 3 ? page + 1 : 3}`)], key: recordKey
  });
  assert.deepEqual(visited, [1, 2, 3]);
  assert.equal(result.reachedEnd, true);
  assert.equal(result.rows.length, 3);
});

test('incremental sync stops at stable known IDs; unidentified rows still traverse fully', async () => {
  const make = ids => ({ firstUrl, fetchPage: async url => Number(new URL(url).searchParams.get('p')),
    parsePage: page => [{ ...(ids ? { id: String(page) } : {}), time: String(page), reason: '抽卡', change: -10 }],
    pageUrls: () => [firstUrl.replace('p=1', 'p=3')], key: recordKey, incremental: true,
    known: [{ id: '2', time: '2', reason: '抽卡', change: -10 }]
  });
  assert.equal((await collectPages(make(true))).pages, 2);
  assert.equal((await collectPages(make(false))).pages, 3);
});

test('pagination rejects unrelated account links and errors on page limits or failed fetch', async () => {
  const doc = new JSDOM(`<a href="/user/2?tab=points_rewards&p=9">other</a><a href="/user/1?tab=notifications&p=8">other tab</a><a href="/user/1?tab=points_rewards&p=2">next</a>`).window.document;
  assert.deepEqual(parser.parsePaginationUrls(doc, firstUrl), ['https://linux.sb/user/1?tab=points_rewards&p=2']);
  await assert.rejects(collectPages({ firstUrl, fetchPage: async () => ({}), parsePage: () => [], pageUrls: () => [firstUrl.replace('p=1', 'p=1001')], key: recordKey }), /分页超过/);
  await assert.rejects(collectPages({ firstUrl, fetchPage: async () => { throw new Error('offline'); }, parsePage: () => [], pageUrls: () => [], key: recordKey }), /offline/);
});

test('account identity uses the signed-in bar and rejects ambiguous or login pages', () => {
  const doc = html => new JSDOM(html).window.document;
  assert.equal(parser.findUserId(doc(`<main><a href="/user/99">帖子作者</a></main>${accountBar('1')}`)), '1');
  assert.equal(parser.findUserId(doc('<main><a href="/user/99">帖子作者</a></main>')), '');
  assert.equal(parser.findUserId(doc(`${accountBar('1')}${accountBar('2')}`)), '');
  assert.equal(parser.findUserId(doc(`${accountBar('1')}<form action="/login"><input type="password"></form>`)), '');
  assert.equal(parser.findUserId(doc('<aside><section class="sidebar-card"><a href="/user/42?tab=points_rewards">💰 我的积分</a><a href="https://linux.sb/user/42?tab=notifications">我的通知</a></section></aside><main><a href="/user/99">作者</a></main>')), '42');
  assert.equal(parser.findUserId(doc('<main><a href="/user/99?tab=points_rewards">我的积分</a></main>')), '');
  assert.equal(parser.findUserId(doc('<aside><a href="https://other.test/user/42">我的积分</a></aside>')), '');
});
