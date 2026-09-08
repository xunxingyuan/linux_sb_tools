(function () {
  'use strict';

  const parser = globalThis.LinuxSbTitleStats;
  if (!parser || location.hostname !== 'linux.sb') return;

  const STORAGE_KEY = 'linuxSbTitleAssistantState';
  const DEFAULT_STATE = {
    version: 1,
    updatedAt: '',
    userId: '',
    current: {
      points: null,
      pool: [],
      titles: [],
      inventory: [],
      ownedTypes: null,
      totalTypes: null
    },
    historyRows: [],
    forgeEvents: [],
    settings: {
      reservePoints: 0,
      confirmEachDraw: true,
      forgeExcludedNames: ['路人甲'],
      forgeKeepOne: true,
      forgeTarget: 'SR'
    }
  };

  const route = location.pathname;
  const isGachaPage = route === '/gacha';
  const isForgePage = route === '/gacha_forge_center';
  if (!isGachaPage && !isForgePage) return;

  let state = null;
  let panel = null;
  let allowNextSubmit = false;

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored[STORAGE_KEY] || {};
    const next = cloneDefaultState();
    Object.assign(next, saved);
    next.current = { ...DEFAULT_STATE.current, ...(saved.current || {}) };
    next.settings = { ...DEFAULT_STATE.settings, ...(saved.settings || {}) };
    next.historyRows = Array.isArray(saved.historyRows) ? saved.historyRows : [];
    next.forgeEvents = Array.isArray(saved.forgeEvents) ? saved.forgeEvents : [];
    return next;
  }

  async function saveState(nextState) {
    nextState.updatedAt = new Date().toISOString();
    state = nextState;
    await chrome.storage.local.set({ [STORAGE_KEY]: nextState });
  }

  function formatNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createMetric(label, value, extraClass) {
    const item = element('div', `lsa-metric${extraClass ? ` ${extraClass}` : ''}`);
    item.append(element('div', 'lsa-metric-label', label), element('div', 'lsa-metric-value', value));
    return item;
  }

  function getInventoryMap(inventory) {
    return new Map((inventory || []).map((item) => [item.name, item]));
  }

  function missingTitles() {
    const owned = getInventoryMap(state.current.inventory);
    return (state.current.titles || []).filter((title) => !owned.has(title.name));
  }

  function createChip(item, missing) {
    const chip = element('li', `lsa-chip${missing ? ' missing' : ''}`);
    const icon = item.icon ? `${item.icon} ` : '';
    chip.textContent = `${icon}${item.name} ${item.rarity}${item.count !== undefined ? ` ×${item.count}` : ''}`;
    return chip;
  }

  function appendChipList(parent, items, missing) {
    const list = element('ul', 'lsa-list');
    if (!items.length) {
      list.append(element('li', 'lsa-empty', missing ? '已收集全部称号' : '暂无数据'));
    } else {
      items.forEach((item) => list.append(createChip(item, missing)));
    }
    parent.append(list);
  }

  function renderHistorySummary(parent) {
    const summary = parser.summarizeHistory(state.historyRows);
    const forgeSummary = parser.summarizeForgeEvents(state.forgeEvents);
    const section = element('section', 'lsa-section');
    const head = element('div', 'lsa-section-head');
    head.append(element('div', 'lsa-section-title', '历史抽取统计'));
    head.append(element('div', 'lsa-muted', `${state.historyRows.length} 条称号流水`));
    section.append(head);

    const metrics = element('div', 'lsa-metrics lsa-history-metrics');
    metrics.append(
      createMetric('累计抽取', `${formatNumber(summary.totalPulls)} 次`),
      createMetric('累计投入', `${formatNumber(summary.totalSpend)} 分`),
      createMetric('回收所得', `${formatNumber(summary.recyclePoints)} 分`),
      createMetric('出售所得', `${formatNumber(summary.sellPoints)} 分`),
      createMetric('购买支出', `${formatNumber(summary.purchasePoints)} 分`),
      createMetric('抽取净额', `${formatNumber(summary.netGachaPoints)} 分`)
    );
    section.append(metrics);

    const detail = element('div', 'lsa-muted');
    detail.textContent = `百连 ${summary.byMode.hundred.batches} 次 · 十连 ${summary.byMode.ten.batches} 次 · 单抽 ${summary.byMode.single.batches} 次`;
    section.append(detail);

    const ssrSection = element('div', 'lsa-history-ssr');
    const ssrHead = element('div', 'lsa-section-head');
    ssrHead.append(element('div', 'lsa-section-title', '历史获得 SSR'));
    ssrHead.append(element('div', 'lsa-muted', forgeSummary.ssrOutputs ? `熔炼通知 · ${forgeSummary.ssrOutputs} 个` : '等待同步'));
    ssrSection.append(ssrHead);
    if (forgeSummary.ssrOutputs) {
      const ssrSummary = element('div', 'lsa-muted');
      const totalSsrTypes = (state.current.titles || []).filter((title) => title.rarity === 'SSR').length;
      ssrSummary.textContent = `已记录 ${forgeSummary.ranked.length}/${totalSsrTypes || '—'} 种 SSR；普通抽卡历史没有逐次结果记录。`;
      ssrSection.append(ssrSummary);
      const ssrList = element('ul', 'lsa-list lsa-history-ssr-list');
      forgeSummary.ranked.forEach((item) => {
        const title = (state.current.titles || []).find((entry) => entry.name === item.name);
        ssrList.append(createChip({
          name: item.name,
          rarity: 'SSR',
          count: item.count,
          icon: title ? title.icon : ''
        }, false));
      });
      ssrSection.append(ssrList);
    } else {
      ssrSection.append(element('div', 'lsa-muted', '点击“同步积分流水”后，从个人熔炼通知中统计历史 SSR。'));
    }
    section.append(ssrSection);
    parent.append(section);
  }

  function renderScoreSummary(parent) {
    const score = parser.scoreForgeProfile({ forgeEvents: state.forgeEvents });
    const forgeDisplay = score.forgeLuckScore === null ? '评价待记录' : score.forgeBand.label;
    const forgeDescription = score.forgeLuckScore === null
      ? '同步到完整的 SSR 熔炼结果后再进行评价'
      : score.forgeBand.description;
    const forgeClass = score.forgeLuckScore === null ? 'lsa-band-insufficient' : `lsa-band-${score.forgeBand.key}`;
    const section = element('section', 'lsa-section');
    const head = element('div', 'lsa-section-head');
    head.append(element('div', 'lsa-section-title', '称号评价'));
    const summaryLabel = element('div', 'lsa-score-summary');
    summaryLabel.append(element('span', `lsa-score-pill ${forgeClass}`, `SSR 熔炼：${forgeDisplay}`));
    head.append(summaryLabel);
    section.append(head);

    const metrics = element('div', 'lsa-metrics');
    metrics.append(
      createMetric('SSR 熔炼评价', forgeDisplay, forgeClass),
      createMetric('评价描述', forgeDescription),
      createMetric('普通抽取', '仅统计'),
      createMetric('结果来源', score.forge.ssrOutputs ? '熔炼通知' : '等待同步')
    );
    section.append(metrics);

    const drought = element('div', 'lsa-muted');
    drought.textContent = '普通抽卡系统不提供逐次结果，因此这里只统计抽取次数和积分流水，不对普通抽卡单独评级。';
    section.append(drought);

    if (score.forge.totalOutputs) {
      const forgeLine = element('div', 'lsa-muted');
      forgeLine.textContent = '熔炼结果已同步，SSR 内部称号分布会参与熔炼梯度。';
      section.append(forgeLine);
    }

    const note = element('div', 'lsa-muted');
    note.style.marginTop = '6px';
    note.textContent = '熔炼稀有度使用相对稀有排序，不代表论坛公开的官方概率；样本越多，评分越稳定。';
    section.append(note);
    parent.append(section);
  }

  const FORGE_STAGES = [
    { source: 'N', target: 'R', cost: 3, label: 'N × 3 → R' },
    { source: 'R', target: 'SR', cost: 3, label: 'R × 3 → SR' },
    { source: 'SR', target: 'SSR', cost: 8, label: 'SR × 8 → SSR' }
  ];

  function forgeMaterialRows(sourceRarity) {
    const rarity = sourceRarity.toLowerCase();
    return Array.from(document.querySelectorAll(`input[type="checkbox"][data-gacha-forge-rarity="${rarity}"]`)).map((checkbox) => {
      const card = checkbox.closest('article') || checkbox.closest('.gacha-operation-card') || checkbox.parentElement;
      const quantityInput = checkbox.closest('label')?.querySelector('input[type="number"]') || card?.querySelector('input[type="number"]');
      const available = Number(quantityInput?.max || checkbox.dataset.gachaForgeQuantity || quantityInput?.value || 0);
      return {
        checkbox,
        quantityInput,
        id: checkbox.value,
        name: card?.querySelector('.gacha-title-name')?.textContent.trim() || `称号 ${checkbox.value}`,
        icon: card?.querySelector('.gacha-title-icon')?.textContent.trim() || '',
        rarity: sourceRarity,
        available: Number.isFinite(available) ? Math.max(0, available) : 0
      };
    });
  }

  function forgeStagePlan(stageIndex, settings) {
    const stage = FORGE_STAGES[stageIndex];
    if (!stage) return null;
    const plan = parser.planForgeMaterials(forgeMaterialRows(stage.source), {
      sourceRarity: stage.source,
      cost: stage.cost,
      excludedNames: settings.excludedNames,
      keepOne: settings.keepOne
    });
    const button = document.querySelector(`button[data-gacha-forge-source="${stage.source}"]`);
    const form = button?.form || button?.closest('form');
    return { ...stage, ...plan, button, form };
  }

  function forgeStageSummary(plan) {
    if (!plan) return '';
    return `${plan.label} ${plan.cycles ? `×${plan.cycles}（消耗 ${plan.materialToUse} 个）` : '暂无可熔铸材料'}`;
  }

  function forgeSequencePreview(targetRarity, settings) {
    const lastStageIndex = targetRarity === 'SSR' ? 2 : 1;
    const carry = {};
    const stages = [];
    for (let index = 0; index <= lastStageIndex; index += 1) {
      const stage = FORGE_STAGES[index];
      const currentPlan = forgeStagePlan(index, settings);
      const generated = Number(carry[stage.source] || 0);
      const currentUsable = Number(currentPlan?.totalUsable || 0);
      const totalUsable = currentUsable + generated;
      const materialToUse = Math.floor(totalUsable / stage.cost) * stage.cost;
      const cycles = materialToUse / stage.cost;
      const plan = {
        ...stage,
        ...(currentPlan || {}),
        totalUsable,
        materialToUse,
        cycles,
        generatedFromPrevious: generated
      };
      stages.push(plan);
      carry[stage.target] = Number(carry[stage.target] || 0) + cycles;
    }

    const consumed = stages
      .filter((stage) => stage.materialToUse > 0)
      .map((stage) => `${stage.materialToUse} 个 ${stage.source}`);
    const output = stages[lastStageIndex];
    const outputText = output.cycles ? `${output.cycles} 个 ${output.target}` : `暂不能生成 ${output.target}`;
    return {
      targetRarity,
      stages,
      summary: consumed.length ? `预计消耗 ${consumed.join('、')}，生成 ${outputText}` : `当前没有可熔铸材料，暂不能生成 ${output.target}`
    };
  }

  function applyForgeStagePlan(plan) {
    if (!plan || !plan.form || !plan.button || !plan.cycles) return false;
    plan.form.querySelectorAll('[data-gacha-forge-rarity]').forEach((checkbox) => {
      checkbox.checked = false;
    });
    plan.rows.forEach((row) => {
      const quantity = row.selectedQuantity;
      if (row.quantityInput) {
        row.quantityInput.value = String(Math.max(1, quantity || 1));
        row.quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
        row.quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      row.checkbox.checked = quantity > 0;
      row.checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const countInput = plan.form.querySelector('[data-gacha-forge-count]');
    if (countInput) countInput.value = String(plan.cycles);
    plan.button.disabled = false;
    return true;
  }

  function clearForgeConfirm() {
    const current = panel && panel.querySelector('.lsa-forge-confirm');
    if (current) current.remove();
  }

  function showForgeConfirm(targetRarity, settings, sequence) {
    clearForgeConfirm();
    const confirm = element('div', 'lsa-confirm lsa-forge-confirm');
    confirm.append(element('div', 'lsa-confirm-text', `确认一键熔铸到 ${targetRarity}？`));
    const excludedText = settings.excludedNames.length ? `排除：${settings.excludedNames.join('、')}` : '不排除额外称号';
    confirm.append(element('div', 'lsa-muted', `${excludedText}；${settings.keepOne ? '每种称号保留 1 个' : '不额外保留称号'}。`));
    confirm.append(element('div', 'lsa-forge-expected', sequence.summary));
    sequence.stages.filter((plan) => plan && plan.cycles).forEach((plan) => confirm.append(element('div', 'lsa-muted', forgeStageSummary(plan))));
    confirm.append(element('div', 'lsa-muted', '确认后每完成一个阶段会刷新页面，并继续执行下一阶段。'));
    const actions = element('div', 'lsa-confirm-actions');
    const cancel = element('button', 'lsa-small-button', '取消');
    const submit = element('button', 'lsa-small-button lsa-primary', '确认一键熔铸');
    cancel.addEventListener('click', clearForgeConfirm);
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      await chrome.storage.local.set({
        pendingForgeChain: {
          targetRarity,
          excludeRoad: settings.excludeRoad,
          keepOne: settings.keepOne,
          stageIndex: 0,
          startedAt: new Date().toISOString()
        }
      });
      clearForgeConfirm();
      await resumeForgeChain();
    });
    actions.append(cancel, submit);
    confirm.append(actions);
    panel.append(confirm);
  }

  async function resumeForgeChain() {
    const stored = await chrome.storage.local.get('pendingForgeChain');
    const chain = stored.pendingForgeChain;
    if (!chain) return;
    if (chain.startedAt && Date.now() - new Date(chain.startedAt).getTime() > 15 * 60 * 1000) {
      await chrome.storage.local.remove('pendingForgeChain');
      showNotice('一键熔铸任务已超时，请重新发起。', 'error');
      return;
    }

    const lastStage = chain.targetRarity === 'SSR' ? 2 : 1;
    let stageIndex = Math.max(0, Number(chain.stageIndex) || 0);
    const settings = {
      excludedNames: Array.isArray(chain.excludedNames) ? chain.excludedNames : ['路人甲'],
      keepOne: chain.keepOne !== false
    };
    while (stageIndex <= lastStage) {
      const plan = forgeStagePlan(stageIndex, settings);
      if (!plan || !plan.cycles || !plan.form || !plan.button) {
        stageIndex += 1;
        await chrome.storage.local.set({ pendingForgeChain: { ...chain, stageIndex } });
        continue;
      }

      const applied = applyForgeStagePlan(plan);
      if (!applied) {
        await chrome.storage.local.remove('pendingForgeChain');
        showNotice(`无法准备 ${plan.label}，请使用站点原生熔炼操作。`, 'error');
        return;
      }
      await chrome.storage.local.set({
        pendingForgeChain: {
          ...chain,
          stageIndex: stageIndex + 1,
          lastStage: plan.label
        }
      });
      showNotice(`正在执行 ${forgeStageSummary(plan)}。`);
      // The plugin already displayed its own confirmation. The forum's inline
      // handler only shows another confirm dialog and does not fill the route;
      // native form.submit() keeps the site's generated forge_count intact.
      plan.form.submit();
      return;
    }

    await chrome.storage.local.remove('pendingForgeChain');
    showNotice(`一键熔铸已完成，目标为 ${chain.targetRarity}。`);
  }

  function renderForgeAssistant(parent) {
    const section = element('section', 'lsa-section lsa-forge-section');
    const head = element('div', 'lsa-section-head');
    head.append(element('div', 'lsa-section-title', '称号熔炼助手'));
    head.append(element('div', 'lsa-muted', '自动分阶段执行'));
    section.append(head);

    const options = element('div', 'lsa-forge-options');
    const keepLabel = document.createElement('label');
    const keep = document.createElement('input');
    keep.type = 'checkbox';
    keep.checked = state.settings.forgeKeepOne !== false;
    keepLabel.append(keep, element('span', '', '每种称号保留 1 个'));
    options.append(keepLabel);

    const exclusionBox = element('div', 'lsa-forge-exclusion-box');
    exclusionBox.append(element('div', 'lsa-muted', '排除称号（可多选）'));
    const exclusionSelect = document.createElement('select');
    exclusionSelect.id = 'lsa-forge-exclusion-select';
    exclusionSelect.multiple = true;
    exclusionSelect.setAttribute('aria-label', '选择要排除的称号');
    const selectableTitles = (state.current.titles || []).filter((item) => ['SR', 'R', 'N'].includes(item.rarity));
    const selectableNames = new Set(selectableTitles.map((item) => item.name));
    const savedExcluded = Array.isArray(state.settings.forgeExcludedNames)
      ? state.settings.forgeExcludedNames
      : ['路人甲'];
    const excludedNames = new Set(savedExcluded.filter((name) => selectableNames.has(name)));
    ['SR', 'R', 'N'].forEach((rarity) => {
      const group = document.createElement('optgroup');
      group.label = rarity;
      selectableTitles.filter((item) => item.rarity === rarity).forEach((item) => {
        const option = document.createElement('option');
        option.value = item.name;
        option.textContent = `${item.icon ? `${item.icon} ` : ''}${item.name}`;
        option.selected = excludedNames.has(item.name);
        group.append(option);
      });
      if (group.children.length) exclusionSelect.append(group);
    });
    exclusionSelect.size = Math.min(9, Math.max(4, selectableNames.size));
    exclusionBox.append(exclusionSelect, element('div', 'lsa-muted', '按住 Command/Ctrl 可同时选择多个称号'));

    const targetOptions = element('div', 'lsa-forge-targets');
    const targetTitle = element('div', 'lsa-muted lsa-forge-target-title', '熔铸目标');
    const targetGroup = element('div', 'lsa-forge-target-group');
    const targetSrLabel = document.createElement('label');
    const targetSr = document.createElement('input');
    targetSr.type = 'radio';
    targetSr.name = 'lsa-forge-target';
    targetSr.value = 'SR';
    targetSr.checked = state.settings.forgeTarget !== 'SSR';
    targetSrLabel.append(targetSr, element('span', '', '仅熔铸到 SR'));
    const targetSsrLabel = document.createElement('label');
    const targetSsr = document.createElement('input');
    targetSsr.type = 'radio';
    targetSsr.name = 'lsa-forge-target';
    targetSsr.value = 'SSR';
    targetSsr.checked = state.settings.forgeTarget === 'SSR';
    targetSsrLabel.append(targetSsr, element('span', '', '熔铸到 SR 后继续到 SSR'));
    targetGroup.append(targetSrLabel, targetSsrLabel);
    targetOptions.append(targetTitle, targetGroup);

    const persistForgeSettings = () => {
      state.settings = {
        ...state.settings,
        forgeExcludedNames: Array.from(excludedNames),
        forgeKeepOne: keep.checked,
        forgeTarget: targetSsr.checked ? 'SSR' : 'SR'
      };
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    };

    const syncExcludedNames = () => {
      excludedNames.clear();
      Array.from(exclusionSelect.selectedOptions).forEach((option) => excludedNames.add(option.value));
    };
    exclusionSelect.addEventListener('change', () => {
      syncExcludedNames();
      persistForgeSettings();
      updatePreview();
    });
    keep.addEventListener('change', () => {
      persistForgeSettings();
      updatePreview();
    });

    const preview = element('div', 'lsa-forge-preview');
    const button = element('button', 'lsa-primary', '一键熔铸');
    function updatePreview() {
      const settings = { excludedNames: Array.from(excludedNames), keepOne: keep.checked };
      const target = targetSsr.checked ? 'SSR' : 'SR';
      const sequence = forgeSequencePreview(target, settings);
      preview.textContent = sequence.summary;
      button.disabled = !sequence.stages.some((plan) => plan && plan.cycles > 0);
      button.dataset.target = target;
    }
    [targetSr, targetSsr].forEach((control) => control.addEventListener('change', () => {
      persistForgeSettings();
      updatePreview();
    }));
    button.addEventListener('click', () => {
      const target = button.dataset.target || 'SR';
      const settings = { excludedNames: Array.from(excludedNames), keepOne: keep.checked };
      showForgeConfirm(target, settings, forgeSequencePreview(target, settings));
    });
    updatePreview();
    section.append(options, exclusionBox, targetOptions, preview, button);
    parent.append(section);
  }

  function renderMissing(parent) {
    const section = element('section', 'lsa-section');
    const head = element('div', 'lsa-section-head');
    head.append(element('div', 'lsa-section-title', `未收集称号（${missingTitles().length}）`));
    section.append(head);
    appendChipList(section, missingTitles(), true);
    parent.append(section);
  }

  function renderInventory(parent) {
    const section = element('section', 'lsa-section');
    const head = element('div', 'lsa-section-head');
    head.append(element('div', 'lsa-section-title', '当前库存'));
    head.append(element('div', 'lsa-muted', `${state.current.inventory.length}/${state.current.totalTypes || '—'} 种`));
    section.append(head);
    appendChipList(section, state.current.inventory, false);
    parent.append(section);
  }

  function showNotice(message, kind) {
    if (!panel) return;
    const current = panel.querySelector('.lsa-notice');
    if (current) current.remove();
    const notice = element('div', 'lsa-notice', message);
    if (kind === 'error') {
      notice.style.background = '#fef2f2';
      notice.style.color = '#991b1b';
    }
    panel.append(notice);
    window.setTimeout(() => notice.remove(), 8000);
  }

  function clearConfirm() {
    const current = panel && panel.querySelector('.lsa-confirm');
    if (current) current.remove();
  }

  function showDrawConfirm(form, cost, modeLabel) {
    clearConfirm();
    const confirm = element('div', 'lsa-confirm');
    confirm.append(element('div', 'lsa-confirm-text', `确认${modeLabel}？本次将消耗 ${formatNumber(cost)} 积分。`));
    const hint = element('div', 'lsa-muted', '普通抽取只保留积分统计，余额保护仍然生效。');
    confirm.append(hint);
    const actions = element('div', 'lsa-confirm-actions');
    const cancel = element('button', 'lsa-small-button', '取消');
    const submit = element('button', 'lsa-small-button lsa-primary', '确认抽取');
    cancel.addEventListener('click', clearConfirm);
    submit.addEventListener('click', () => {
      submit.disabled = true;
      allowNextSubmit = true;
      clearConfirm();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    });
    actions.append(cancel, submit);
    confirm.append(actions);
    panel.append(confirm);
  }

  function attachDrawGuards() {
    document.querySelectorAll('.gacha-actions form').forEach((form) => {
      if (form.dataset.lsaGuardAttached === '1') return;
      form.dataset.lsaGuardAttached = '1';
      form.addEventListener('submit', (event) => {
        const button = form.querySelector('button[data-cost]');
        const cost = Number(button && button.dataset.cost) || 0;
        const modeLabel = button ? button.textContent.replace(/\s*\(.*/, '').trim() : '抽取';

        if (allowNextSubmit) {
          allowNextSubmit = false;
          return;
        }

        const reserve = Math.max(0, Number(state.settings.reservePoints || 0));
        if (Number.isFinite(state.current.points) && state.current.points - cost < reserve) {
          event.preventDefault();
          showNotice(`余额保护已阻止本次操作：至少保留 ${formatNumber(reserve)} 积分。`, 'error');
          return;
        }

        if (state.settings.confirmEachDraw) {
          event.preventDefault();
          showDrawConfirm(form, cost, modeLabel);
        }
      });
    });
  }

  async function fetchDocument(url) {
    const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  async function fetchProfile() {
    return parser.parseProfilePage(await fetchDocument('/gacha_profile'));
  }

  async function refreshCurrentData() {
    const page = parser.parseGachaPage(document);
    const profile = await fetchProfile().catch(() => null);
    state.userId = parser.findUserId(document) || state.userId;
    state.current = {
      ...state.current,
      points: page && page.points !== null ? page.points : (parser.parseCurrentPoints(document) ?? state.current.points),
      pool: page ? page.pool : state.current.pool,
      titles: page ? page.titles : state.current.titles,
      ownedTypes: profile ? profile.ownedTypes : (page ? page.ownedTypes : state.current.ownedTypes),
      totalTypes: page && page.totalTypes ? page.totalTypes : state.current.totalTypes,
      inventory: profile ? profile.inventory : state.current.inventory
    };
    await saveState(state);
    return profile;
  }

  async function refreshForgePageData() {
    const profile = await fetchProfile().catch(() => null);
    const gachaDoc = await fetchDocument('/gacha').catch(() => null);
    const gacha = gachaDoc ? parser.parseGachaPage(gachaDoc) : null;
    state.userId = parser.findUserId(document) || state.userId;
    state.current = {
      ...state.current,
      points: parser.parseCurrentPoints(document) ?? (gacha && gacha.points !== null ? gacha.points : state.current.points),
      pool: gacha && gacha.pool.length ? gacha.pool : state.current.pool,
      titles: gacha && gacha.titles.length ? gacha.titles : state.current.titles,
      inventory: profile ? profile.inventory : state.current.inventory,
      ownedTypes: profile ? profile.ownedTypes : state.current.ownedTypes,
      totalTypes: gacha && gacha.totalTypes ? gacha.totalTypes : state.current.totalTypes
    };
    await saveState(state);
    return profile;
  }

  async function syncHistory() {
    if (!state.userId) state.userId = parser.findUserId(document);
    if (!state.userId) throw new Error('未找到当前用户编号');
    const firstUrl = `/user/${state.userId}?tab=points_rewards&p=1`;
    const firstDoc = await fetchDocument(firstUrl);
    const urls = parser.parsePaginationUrls(firstDoc, location.origin + firstUrl);
    const allUrls = Array.from(new Set([firstUrl, ...urls]));
    const rows = [];
    for (const url of allUrls) {
      const doc = url === firstUrl ? firstDoc : await fetchDocument(url);
      rows.push(...parser.parsePointsHistoryPage(doc));
    }
    const unique = new Map();
    rows.forEach((row) => unique.set(`${row.time}|${row.reason}|${row.change}`, row));
    state.historyRows = Array.from(unique.values()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    let notificationError = null;
    try {
      await syncNotifications();
    } catch (error) {
      notificationError = error;
    }
    await saveState(state);
    render();
    showNotice(notificationError
      ? `已同步 ${state.historyRows.length} 条称号流水；熔炼通知暂时同步失败。`
      : `已同步 ${state.historyRows.length} 条称号流水和 ${state.forgeEvents.length} 次熔炼记录。`);
  }

  async function syncNotifications() {
    if (!state.userId) state.userId = parser.findUserId(document);
    if (!state.userId) throw new Error('未找到当前用户编号');
    const firstUrl = `/user/${state.userId}?tab=notifications&p=1`;
    const firstDoc = await fetchDocument(firstUrl);
    const urls = parser.parsePaginationUrls(firstDoc, location.origin + firstUrl, 'notifications');
    const allUrls = Array.from(new Set([firstUrl, ...urls]));
    const events = [];
    for (const url of allUrls) {
      const doc = url === firstUrl ? firstDoc : await fetchDocument(url);
      events.push(...parser.parseNotificationPage(doc));
    }
    const unique = new Map();
    events.forEach((event) => unique.set(`${event.time}|${event.text}`, event));
    state.forgeEvents = Array.from(unique.values());
    return state.forgeEvents;
  }

  function createPanel() {
    const root = element('section', 'linux-sb-title-assistant');
    root.id = 'linux-sb-title-assistant';
    const header = element('div', 'lsa-header');
    const titleWrap = element('div');
    titleWrap.append(
      element('div', 'lsa-title', '🧰 LINUX SB 扩展工具箱'),
      element('div', 'lsa-subtitle', isForgePage ? '称号熔炼助手 · 当前功能' : '称号抽取统计 · 当前功能')
    );
    header.append(titleWrap, element('div', 'lsa-header-badge', '本地统计'));
    root.append(header);
    panel = root;
    return root;
  }

  function mountPanel() {
    const existing = document.getElementById('linux-sb-title-assistant');
    if (existing) existing.remove();
    const root = createPanel();
    const target = document.querySelector('.gacha-center-page') || document.querySelector('main') || document.body;
    if (isGachaPage) {
      const actions = target.querySelector('.gacha-actions');
      if (actions) actions.insertAdjacentElement('beforebegin', root);
      else target.prepend(root);
    } else {
      target.prepend(root);
    }
  }

  function render() {
    if (!panel) mountPanel();
    while (panel.children.length > 1) panel.lastElementChild.remove();

    if (isForgePage) {
      renderForgeAssistant(panel);
      return;
    }

    const summary = parser.summarizeHistory(state.historyRows);
    const metrics = element('div', 'lsa-metrics');
    metrics.append(
      createMetric('当前积分', formatNumber(state.current.points)),
      createMetric('收集进度', `${state.current.ownedTypes || state.current.inventory.length}/${state.current.totalTypes || '—'}`),
      createMetric('累计抽取', `${formatNumber(summary.totalPulls)} 次`),
      createMetric('累计投入', `${formatNumber(summary.totalSpend)} 分`)
    );
    panel.append(metrics);

    const actions = element('div', 'lsa-actions');
    const refresh = element('button', 'lsa-small-button', '刷新页面数据');
    const sync = element('button', 'lsa-small-button', '同步积分流水');
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try {
        await refreshCurrentData();
        render();
        showNotice('页面数据已刷新。');
      } catch (error) {
        showNotice(error.message || '刷新失败。', 'error');
      } finally {
        refresh.disabled = false;
      }
    });
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      try {
        await syncHistory();
      } catch (error) {
        showNotice(error.message || '积分流水同步失败。', 'error');
      } finally {
        sync.disabled = false;
      }
    });
    actions.append(refresh, sync);
    panel.append(actions);

    if (state.current.inventory.length) renderInventory(panel);
    if (state.current.titles.length) renderMissing(panel);
    renderHistorySummary(panel);
    renderScoreSummary(panel);

  }

  async function handleMessage(message) {
    if (!message || !message.type) return { ok: false };
    if (message.type === 'GET_SNAPSHOT') {
      return { ok: true, state };
    }
    if (message.type === 'REFRESH') {
      try {
        if (isForgePage) await refreshForgePageData();
        else await refreshCurrentData();
        render();
        return { ok: true, state };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    if (message.type === 'SYNC_HISTORY') {
      try {
        await syncHistory();
        return { ok: true, state };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    return { ok: false };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true;
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    state = await loadState();
    if (panel) {
      render();
      if (isGachaPage) attachDrawGuards();
    }
  });

  (async function init() {
    state = await loadState();
    if (isGachaPage) {
      try {
        await refreshCurrentData();
      } catch (error) {
        console.warn('[LINUX SB 称号助手]', error);
      }
      mountPanel();
      render();
      attachDrawGuards();
    } else if (isForgePage) {
      try {
        await refreshForgePageData();
      } catch (error) {
        console.warn('[LINUX SB 扩展工具箱]', error);
      }
      mountPanel();
      render();
      await resumeForgeChain();
    }
  })();
})();
