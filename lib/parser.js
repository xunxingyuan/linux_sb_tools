(function attachParser(global) {
  'use strict';

  const RARITY_ORDER = ['UR', 'SSR', 'SR', 'R', 'N'];
  const DRAW_MODES = [
    { key: 'single', mode: 'single', label: '单抽', pulls: 1, cost: 10 },
    { key: 'ten', mode: 'ten', label: '十连', pulls: 10, cost: 90 },
    { key: 'hundred', mode: 'hundred', label: '百连', pulls: 100, cost: 800 }
  ];

  const FORGE_RECIPES = [
    { inputRarity: 'N', inputCount: 3, outputRarity: 'R', outputCount: 1 },
    { inputRarity: 'R', inputCount: 3, outputRarity: 'SR', outputCount: 1 },
    { inputRarity: 'SR', inputCount: 8, outputRarity: 'SSR', outputCount: 1 }
  ];

  // The forum does not expose official per-title forge probabilities. These
  // ranks only express the user's qualitative ordering and are not treated as
  // official probabilities.
  const FORGE_RARITY_RANK = {
    '氪金大佬': 1,
    '全站偶像': 1,
    '欧皇': 3,
    '传说之龙': 4,
    '隐藏大佬': 5,
    '管理员之友': 6,
    '富可敌国': 7
  };

  const FORGE_BASELINE_RATES = {
    '氪金大佬': 0.45,
    '全站偶像': 0.40,
    '欧皇': 0.06,
    '传说之龙': 0.035,
    '隐藏大佬': 0.025,
    '管理员之友': 0.025,
    '富可敌国': 0.005
  };

  const SCORE_BANDS = [
    { key: 'chosen', min: 90, label: '天选之子', description: '命运主动给你让路' },
    { key: 'emperor', min: 75, label: '欧气成精', description: '走到哪里都能捡到 SSR' },
    { key: 'lucky', min: 60, label: '锦鲤转世', description: '偶尔被好运精准命中' },
    { key: 'normal', min: 40, label: '随机路人', description: '一切符合概率预期' },
    { key: 'unlucky', min: 20, label: '保底受害者', description: '好运总在下一抽' },
    { key: 'unlucky_extreme', min: 0, label: '非酋降临', description: '黑暗降临，寸草不生' }
  ];

  function textOf(node) {
    return node && typeof node.textContent === 'string'
      ? node.textContent.replace(/\s+/g, ' ').trim()
      : '';
  }

  function numberFromText(value) {
    const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function extractSignedNumber(value) {
    const match = String(value || '').replace(/,/g, '').match(/[+-]\s*\d+(?:\.\d+)?/);
    if (!match) return null;
    return Number(match[0].replace(/\s/g, ''));
  }

  function normalizeRarity(value) {
    const rarity = String(value || '').toUpperCase();
    return RARITY_ORDER.includes(rarity) ? rarity : '';
  }

  function classifyHistoryReason(reason) {
    const value = String(reason || '').trim();
    if (/百连抽/.test(value)) return { kind: 'draw', mode: 'hundred', pulls: 100 };
    if (/十连抽/.test(value)) return { kind: 'draw', mode: 'ten', pulls: 10 };
    if (/抽卡|单抽/.test(value)) return { kind: 'draw', mode: 'single', pulls: 1 };
    if (/回收/.test(value)) return { kind: 'recycle', mode: '', pulls: 0 };
    if (/出售称号/.test(value)) return { kind: 'sell', mode: '', pulls: 0 };
    if (/购买称号/.test(value)) return { kind: 'buy', mode: '', pulls: 0 };
    return { kind: 'other', mode: '', pulls: 0 };
  }

  function isTitleHistoryReason(reason) {
    return classifyHistoryReason(reason).kind !== 'other';
  }

  function parseGachaPage(doc) {
    if (!doc || !doc.querySelectorAll) return null;

    const statsText = [
      textOf(doc.querySelector('.gacha-center-stat')),
      textOf(doc.querySelector('.gacha-sub-stats'))
    ].filter(Boolean).join(' ');
    const pointsMatch = statsText.match(/积分\s*[：:]?\s*([\d,]+)/);
    const collectionMatch = statsText.match(/称号\s*[：:]?\s*(\d+)\s*\/\s*(\d+)/);

    const pool = Array.from(doc.querySelectorAll('.gacha-pool-rarity')).map((node) => {
      const rarity = normalizeRarity(textOf(node.querySelector('.gacha-pool-rarity-label')));
      return {
        rarity,
        types: numberFromText(textOf(node.querySelector('.gacha-pool-rarity-count'))),
        rate: numberFromText(textOf(node.querySelector('.gacha-pool-rarity-rate')))
      };
    }).filter((item) => item.rarity);

    const titles = Array.from(doc.querySelectorAll('.gacha-all-item')).map((node) => ({
      icon: textOf(node.querySelector('.gacha-title-icon')),
      name: textOf(node.querySelector('.gacha-title-name')),
      rarity: normalizeRarity(textOf(node.querySelector('.gacha-title-rarity')))
    })).filter((item) => item.name && item.rarity);

    return {
      points: pointsMatch ? Number(pointsMatch[1].replace(/,/g, '')) : null,
      ownedTypes: collectionMatch ? Number(collectionMatch[1]) : null,
      totalTypes: collectionMatch ? Number(collectionMatch[2]) : titles.length || null,
      pool,
      titles,
      results: parseResultNodes(doc)
    };
  }

  function parseCurrentPoints(doc) {
    if (!doc) return null;
    const candidates = [
      ...Array.from(doc.querySelectorAll('.gacha-center-stat, .gacha-sub-stats')),
      doc.body
    ];
    for (const node of candidates) {
      const match = textOf(node).match(/积分\s*[：:]?\s*([\d,]+)/);
      if (match) return Number(match[1].replace(/,/g, ''));
    }
    return null;
  }

  function parseProfilePage(doc) {
    if (!doc || !doc.querySelectorAll) return null;

    const inventory = Array.from(doc.querySelectorAll('.gacha-profile-item')).map((node) => {
      const badge = node.querySelector('.gacha-title-badge');
      const name = textOf(node.querySelector('.gacha-title-name'));
      const rarity = normalizeRarity(textOf(node.querySelector('.gacha-title-rarity')));
      const metaText = textOf(node.querySelector('.gacha-profile-meta'));
      const countMatch = metaText.match(/×\s*([\d,]+)/);
      const dateMatch = metaText.match(/(\d{4}-\d{2}-\d{2})/);
      return {
        icon: textOf(node.querySelector('.gacha-title-icon')),
        name,
        rarity,
        count: countMatch ? Number(countMatch[1].replace(/,/g, '')) : 0,
        acquiredAt: dateMatch ? dateMatch[1] : '',
        equipped: node.classList ? node.classList.contains('is-equipped') : false,
        badgeClass: badge ? badge.className : ''
      };
    }).filter((item) => item.name && item.rarity);

    const headerText = textOf(doc.querySelector('.gacha-center-stat'));
    const typeMatch = headerText.match(/(\d+)\s*种称号/);
    return {
      inventory,
      ownedTypes: typeMatch ? Number(typeMatch[1]) : inventory.length,
      totalCopies: inventory.reduce((sum, item) => sum + item.count, 0)
    };
  }

  function parsePointsHistoryPage(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    return Array.from(doc.querySelectorAll('.points-rewards-detail')).map((node) => {
      const reason = textOf(node.querySelector('.points-rewards-reason'));
      const changeNode = node.querySelector('.points-rewards-change-value');
      const timeNode = node.querySelector('.points-rewards-time');
      const classification = classifyHistoryReason(reason);
      return {
        id: node.getAttribute('data-id') || node.id || '',
        reason,
        change: extractSignedNumber(textOf(changeNode)),
        time: timeNode ? (timeNode.getAttribute('datetime') || textOf(timeNode)) : '',
        ...classification
      };
    }).filter((row) => row.reason && isTitleHistoryReason(row.reason));
  }

  function parsePaginationUrls(doc, baseUrl, tabName) {
    if (!doc || !doc.querySelectorAll) return [];
    const base = new URL(baseUrl || (global.location && global.location.href) || 'https://linux.sb/');
    const expectedTab = tabName || 'points_rewards';
    const urls = new Set();
    Array.from(doc.querySelectorAll('a[href]')).forEach((anchor) => {
      try {
        const url = new URL(anchor.getAttribute('href'), base.href);
        if (url.origin === base.origin && url.pathname === base.pathname && url.searchParams.get('tab') === expectedTab) {
          urls.add(url.href);
        }
      } catch (_error) {
        // Ignore malformed links from page extensions.
      }
    });
    return Array.from(urls);
  }

  function parseResultNodes(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    const selectors = [
      '[data-gacha-result]',
      '.gacha-result',
      '.gacha-pull-result',
      '.gacha-reward',
      '.gacha-result-item',
      '.gacha-pull-result-item'
    ];
    const nodes = [];
    selectors.forEach((selector) => {
      Array.from(doc.querySelectorAll(selector)).forEach((node) => {
        const text = textOf(node);
        if (text && !nodes.some((item) => item.text === text)) nodes.push({ text });
      });
    });

    if (nodes.length) return nodes;

    const candidates = Array.from(doc.querySelectorAll('main, .main-panel, .gacha-center-page'));
    for (const node of candidates) {
      const text = textOf(node);
      if (/恭喜你|抽取结果|获得称号|本次抽取|本次获得/.test(text)) {
        const match = text.match(/(?:恭喜[^。！!]*?|抽到了|获得称号)\s*([\p{Extended_Pictographic}\p{Emoji_Presentation}]?\s*[\u4e00-\u9fa5A-Za-z0-9·之友大佬]+(?:\s*[A-Z]{1,3})?)/u);
        if (match) nodes.push({ text: match[1].trim() });
      }
    }
    return nodes;
  }

  function parseForgeNotification(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    const match = value.match(/你消耗了\s*([\d,]+)\s*个\s*(N|R|SR|SSR)\s*称号，批量熔炼获得\s*([\d,]+)\s*个\s*(N|R|SR|SSR)\s*[：:]\s*(.+?)(?:[。！!]|$)/);
    if (!match) return null;

    const inputCount = Number(match[1].replace(/,/g, ''));
    const outputCount = Number(match[3].replace(/,/g, ''));
    const outputRarity = normalizeRarity(match[4]);
    const outcomes = match[5].split(/[、,，]/).map((part) => {
      const result = part.trim().match(/^(.+?)\s*[×x*]\s*([\d,]+)$/);
      if (!result) return null;
      return {
        name: result[1].trim(),
        count: Number(result[2].replace(/,/g, '')),
        rarity: outputRarity
      };
    }).filter((item) => item && item.name && item.count > 0);

    if (!outcomes.length) return null;
    return {
      kind: 'forge',
      inputRarity: normalizeRarity(match[2]),
      inputCount,
      outputRarity,
      outputCount,
      outcomes,
      text: value
    };
  }

  function parseNotificationPage(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    return Array.from(doc.querySelectorAll('.notification-item')).map((node) => {
      const who = textOf(node.querySelector('.post-title'));
      const text = textOf(node.querySelector('.notification-content'));
      const timeNode = node.querySelector('.post-meta');
      const forge = who === '系统' ? parseForgeNotification(text) : null;
      return forge ? {
        ...forge,
        id: node.getAttribute('data-id') || node.id || '',
        time: timeNode ? textOf(timeNode) : ''
      } : null;
    }).filter(Boolean);
  }

  function inventoryMap(inventory) {
    return new Map((Array.isArray(inventory) ? inventory : []).map((item) => [item.name, item.count || 0]));
  }

  function diffInventory(before, after) {
    const previous = inventoryMap(before);
    const current = inventoryMap(after);
    const names = new Set([...previous.keys(), ...current.keys()]);
    return Array.from(names).map((name) => {
      const delta = (current.get(name) || 0) - (previous.get(name) || 0);
      const item = (after || []).find((entry) => entry.name === name) || (before || []).find((entry) => entry.name === name);
      return item && delta > 0 ? { ...item, count: delta } : null;
    }).filter(Boolean);
  }

  function summarizeHistory(rows) {
    const history = Array.isArray(rows) ? rows : [];
    const summary = {
      drawBatches: 0,
      totalPulls: 0,
      totalSpend: 0,
      recyclePoints: 0,
      sellPoints: 0,
      purchasePoints: 0,
      byMode: {
        single: { batches: 0, pulls: 0, cost: 0 },
        ten: { batches: 0, pulls: 0, cost: 0 },
        hundred: { batches: 0, pulls: 0, cost: 0 }
      },
      firstTime: '',
      lastTime: ''
    };

    for (const row of history) {
      const change = Number(row.change || 0);
      if (row.kind === 'draw') {
        summary.drawBatches += 1;
        summary.totalPulls += Number(row.pulls || 0);
        summary.totalSpend += Math.abs(change);
        if (summary.byMode[row.mode]) {
          summary.byMode[row.mode].batches += 1;
          summary.byMode[row.mode].pulls += Number(row.pulls || 0);
          summary.byMode[row.mode].cost += Math.abs(change);
        }
      } else if (row.kind === 'recycle') {
        summary.recyclePoints += Math.max(0, change);
      } else if (row.kind === 'sell') {
        summary.sellPoints += Math.max(0, change);
      } else if (row.kind === 'buy') {
        summary.purchasePoints += Math.abs(Math.min(0, change));
      }
      if (row.time) {
        if (!summary.firstTime || row.time < summary.firstTime) summary.firstTime = row.time;
        if (!summary.lastTime || row.time > summary.lastTime) summary.lastTime = row.time;
      }
    }

    summary.netGachaPoints = summary.recyclePoints + summary.sellPoints - summary.purchasePoints - summary.totalSpend;
    return summary;
  }

  function summarizeForgeEvents(events) {
    const list = Array.isArray(events) ? events : [];
    const counts = {};
    const allCounts = {};
    const byOutputRarity = { UR: 0, SSR: 0, SR: 0, R: 0, N: 0 };
    let totalOutputs = 0;
    let totalInputs = 0;
    let ssrOutputs = 0;
    for (const event of list) {
      totalInputs += Number(event.inputCount || 0);
      totalOutputs += Number(event.outputCount || 0);
      if (byOutputRarity[event.outputRarity] !== undefined) {
        byOutputRarity[event.outputRarity] += Number(event.outputCount || 0);
      }
      if (event.outputRarity === 'SSR') ssrOutputs += Number(event.outputCount || 0);
      for (const outcome of event.outcomes || []) {
        const count = Number(outcome.count || 0);
        allCounts[outcome.name] = (allCounts[outcome.name] || 0) + count;
        if (event.outputRarity === 'SSR' || outcome.rarity === 'SSR') {
          counts[outcome.name] = (counts[outcome.name] || 0) + count;
        }
      }
    }
    const ranked = Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        observedRate: ssrOutputs ? count / ssrOutputs : 0,
        rank: FORGE_RARITY_RANK[name] || 2
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const weightedAverage = ssrOutputs
      ? ranked.reduce((sum, item) => sum + item.rank * item.count, 0) / ssrOutputs
      : null;
    const baselineAverage = Object.entries(FORGE_BASELINE_RATES)
      .reduce((sum, [name, rate]) => sum + (FORGE_RARITY_RANK[name] || 2) * rate, 0);
    const rawRareScore = weightedAverage === null
      ? null
      : Math.max(0, Math.min(100, 50 + ((weightedAverage - baselineAverage) / (7 - baselineAverage)) * 50));
    const confidence = ssrOutputs ? Math.min(1, Math.sqrt(ssrOutputs / 50)) : 0;
    const rareScore = rawRareScore === null
      ? null
      : Math.round(50 + (rawRareScore - 50) * confidence);
    return {
      events: list.length,
      totalInputs,
      totalOutputs,
      ssrOutputs,
      byOutputRarity,
      counts,
      allCounts,
      ranked,
      baselineAverage,
      weightedAverage,
      confidence,
      rareScore
    };
  }

  function scoreBand(score) {
    if (score === null || score === undefined || !Number.isFinite(Number(score))) {
      return { key: 'insufficient', min: null, label: '评价待记录', description: '记录到完整结果后再进行评价' };
    }
    return SCORE_BANDS.find((band) => Number(score) >= band.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
  }

  function planForgeMaterials(items, { sourceRarity, cost, excludeRoad = true, excludedNames, keepOne = true } = {}) {
    const materialCost = Math.max(1, Number(cost) || 1);
    const exclusions = new Set(Array.isArray(excludedNames) ? excludedNames : []);
    const rows = (Array.isArray(items) ? items : []).map((item) => {
      const available = Math.max(0, Number(item.available || 0));
      const excluded = exclusions.has(item.name) || (excludeRoad && sourceRarity === 'N' && item.name === '路人甲');
      const reserve = keepOne ? 1 : 0;
      return {
        ...item,
        available,
        usable: excluded ? 0 : Math.max(0, available - reserve),
        selectedQuantity: 0
      };
    });
    const totalUsable = rows.reduce((sum, row) => sum + row.usable, 0);
    const materialToUse = Math.floor(totalUsable / materialCost) * materialCost;
    let remaining = materialToUse;
    rows.forEach((row) => {
      row.selectedQuantity = Math.min(row.usable, remaining);
      remaining -= row.selectedQuantity;
    });
    return {
      rows,
      totalUsable,
      materialToUse,
      cycles: materialToUse / materialCost
    };
  }

  function scoreForgeProfile({ forgeEvents, totalSpend } = {}) {
    const forge = summarizeForgeEvents(forgeEvents);
    const forgeLuckScore = forge.rareScore;
    const forgeBand = scoreBand(forgeLuckScore);
    return {
      forge,
      forgeLuckScore,
      forgeBand,
      totalSpend: Number(totalSpend || 0),
      labels: forgeBand.label === '评价待记录' ? [] : [forgeBand.label]
    };
  }

  function planDraws(points, reservePoints) {
    const reserve = Math.max(0, Number(reservePoints || 0));
    const available = Math.max(0, Number(points || 0) - reserve);
    let remaining = available;
    const plan = [];
    for (const mode of [...DRAW_MODES].reverse()) {
      const count = Math.floor(remaining / mode.cost);
      if (count > 0) {
        plan.push({ ...mode, count, totalCost: count * mode.cost, totalPulls: count * mode.pulls });
        remaining -= count * mode.cost;
      }
    }
    return {
      available,
      remaining: reserve + remaining,
      unallocated: remaining,
      totalCost: available - remaining,
      totalPulls: plan.reduce((sum, item) => sum + item.totalPulls, 0),
      plan: plan.reverse()
    };
  }

  function findUserId(doc) {
    if (!doc || !doc.querySelectorAll) return '';
    if (doc.querySelector('form[action="/login"], input[type="password"]')) return '';
    const ids = new Set();
    // Account controls may live in the top bar OR the personal sidebar card.
    // Only "我的…" sidebar navigation identifies the signed-in user, not authors.
    const controls = Array.from(doc.querySelectorAll('.bar-right a[href*="/user/"], [data-current-user-id]'));
    const personal = Array.from(doc.querySelectorAll('aside a[href*="/user/"], .sidebar-card a[href*="/user/"]'))
      .filter(anchor => /我的(?:积分|通知|主题|回帖|收藏)\s*$/.test(textOf(anchor)));
    for (const anchor of [...controls, ...personal]) {
      const explicit = anchor.getAttribute('data-current-user-id');
      let path = '';
      try {
        const url = new URL(anchor.getAttribute('href') || '', 'https://linux.sb');
        if (url.origin === 'https://linux.sb') path = url.pathname;
      } catch (_error) { /* Ignore invalid navigation links. */ }
      const match = path.match(/^\/user\/(\d+)(?:\/|$)/);
      if (/^\d+$/.test(explicit || '')) ids.add(explicit);
      else if (match) ids.add(match[1]);
    }
    return ids.size === 1 ? [...ids][0] : '';
  }

  const api = {
    DRAW_MODES,
    FORGE_BASELINE_RATES,
    FORGE_RARITY_RANK,
    FORGE_RECIPES,
    RARITY_ORDER,
    SCORE_BANDS,
    classifyHistoryReason,
    diffInventory,
    extractSignedNumber,
    findUserId,
    normalizeRarity,
    numberFromText,
    parseCurrentPoints,
    parseForgeNotification,
    parseGachaPage,
    parseNotificationPage,
    parsePaginationUrls,
    parsePointsHistoryPage,
    parseProfilePage,
    parseResultNodes,
    planForgeMaterials,
    planDraws,
    scoreForgeProfile,
    scoreBand,
    summarizeForgeEvents,
    summarizeHistory,
    textOf
  };

  global.LinuxSbTitleStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
