(function () {
  'use strict';

  const parser = globalThis.LinuxSbTitleStats;
  if (!parser || location.hostname !== 'linux.sb') return;

  const store = globalThis.LinuxSbState;
  const STORAGE_KEY = store.STORAGE_KEY;
  const route = location.pathname;
  const isGachaPage = route === '/gacha';
  const isForgePage = route === '/gacha_forge_center';
  if (!isGachaPage && !isForgePage) return;

  let state = null;
  let panel = null;
  let approvedDraw = null;
  let drawCheckPending = false;
  let updatePromise = null;
  let forgeRunning = false;
  let forgeTask = null;
  let forgeStatus = '';
  let forgeStatusTaskId = '';
  let syncForgeControls = () => {};
  const documentToken = crypto.randomUUID();
  const folded = new Map();

  async function loadState() {
    return store.request('GET', { userId: parser.findUserId(document) });
  }

  async function requireAccount() {
    const userId = parser.findUserId(document);
    if (!userId) throw new Error('未确认当前登录账号，请登录并刷新页面');
    if (state?.userId !== userId) state = await store.request('GET', { userId });
    return userId;
  }

  function details(key, label, build) {
    const node = element('details', 'lsa-details');
    node.open = folded.get(key) || false;
    node.append(element('summary', '', label));
    const body = element('div', 'lsa-details-body');
    node.append(body);
    let built = false;
    const populate = () => { if (!built) { build(body); built = true; } };
    if (node.open) populate();
    node.addEventListener('toggle', () => {
      folded.set(key, node.open);
      if (node.open) populate();
    });
    return node;
  }

  function formatNumber(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
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

  const FORGE_STAGES = globalThis.LinuxSbForge.STAGES;

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
      summary: consumed.length ? `理论上限：各阶段最多消耗 ${consumed.join('、')}，最终生成 ${outputText}。新产出仍需扣除排除项和保留数量，实际结果以每阶段库存为准。` : `当前没有可熔铸材料，暂不能生成 ${output.target}`
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
    return !plan.button.disabled && plan.form.checkValidity();
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
      try {
        const userId = await requireAccount();
        forgeTask = await store.request('FORGE_START', {
          userId, targetRarity, excludedNames: Array.from(settings.excludedNames || []), keepOne: settings.keepOne
        });
        clearForgeConfirm();
        renderForgeProgress();
        await resumeForgeChain();
      } catch (error) {
        submit.disabled = false;
        showNotice(error.message, 'error');
      }
    });
    actions.append(cancel, submit);
    confirm.append(actions);
    panel.append(confirm);
  }

  function renderForgeProgress(message) {
    panel?.querySelector('.lsa-forge-progress')?.remove();
    if (!forgeTask) return;
    if (forgeStatusTaskId !== forgeTask.id) { forgeStatus = ''; forgeStatusTaskId = forgeTask.id; }
    if (message !== undefined) forgeStatus = message;
    const row = element('div', 'lsa-forge-progress');
    row.setAttribute('aria-live', 'polite');
    row.append(element('span', '', forgeStatus || `熔铸至 ${forgeTask.targetRarity} · 阶段 ${Math.min(forgeTask.stageIndex + 1, 3)}/${forgeTask.targetRarity === 'SSR' ? 3 : 2}`));
    const stop = element('button', 'lsa-small-button', '停止任务');
    stop.addEventListener('click', async () => {
      stop.disabled = true;
      try {
        await store.request('FORGE_STOP', { userId: state.userId, id: forgeTask.id });
        forgeTask = null;
        row.remove();
        render();
        showNotice('已停止后续阶段；已提交的操作仍由站点处理。');
      } catch (error) { stop.disabled = false; showNotice(error.message, 'error'); }
    });
    row.append(stop);
    panel.append(row);
  }

  async function resumeForgeChain() {
    if (forgeRunning) return;
    forgeRunning = true;
    try {
      const userId = await requireAccount();
      let chain = await store.request('FORGE_GET', { userId });
      forgeTask = chain;
      if (!chain) return;
      renderForgeProgress();
      if (!chain.ownedByTab) {
        renderForgeProgress('任务由另一个标签页执行');
        return;
      }
      if (chain.phase === 'awaiting') {
        const profile = await fetchProfile();
        chain = await store.request('FORGE_STEP', { userId, id: chain.id, documentToken, inventory: profile.inventory });
        forgeTask = chain;
      }
      const lastStage = chain.targetRarity === 'SSR' ? 2 : 1;
      while (chain.stageIndex <= lastStage) {
        const plan = forgeStagePlan(chain.stageIndex, chain);
        if (!plan?.form || !plan.button) throw new Error('未找到站点熔铸表单，任务已暂停，请停止后核对页面');
        if (!plan.cycles) {
          chain = await store.request('FORGE_STEP', { userId, id: chain.id, stageIndex: chain.stageIndex, skip: true });
          forgeTask = chain;
          continue;
        }
        renderForgeProgress(`即将执行 ${forgeStageSummary(plan)}，3 秒后继续`);
        await new Promise(resolve => window.setTimeout(resolve, 3000));
        const fresh = await store.request('FORGE_GET', { userId });
        if (!fresh || fresh.id !== chain.id) return;
        // Fetch current account and inventory immediately before spending material.
        const profile = await fetchProfile();
        for (const row of plan.rows.filter(row => row.selectedQuantity > 0)) {
          const current = profile.inventory.find(item => item.rarity === plan.source && item.name === row.name);
          if (!current || current.count !== row.available) throw new Error('库存已变化，任务已暂停，请刷新后核对');
        }
        if (!applyForgeStagePlan(plan)) throw new Error('站点暂不允许提交，任务已暂停');
        const proof = {
          stageIndex: chain.stageIndex, cycles: plan.cycles, before: profile.inventory,
          selected: plan.rows.filter(row => row.selectedQuantity > 0).map(row => ({ name: row.name, quantity: row.selectedQuantity }))
        };
        forgeTask = await store.request('FORGE_STEP', { userId, id: chain.id, documentToken, proof });
        renderForgeProgress(`已提交 ${plan.label}，等待站点结果；刷新后核对库存再继续`);
        // Native submission retains the site's generated action and hidden fields.
        HTMLFormElement.prototype.submit.call(plan.form);
        return;
      }
      await store.request('FORGE_STOP', { userId, id: chain.id });
      forgeTask = null;
      render();
      showNotice('可执行的熔铸阶段已完成，库存不足的阶段已跳过。');
    } catch (error) {
      if (forgeTask) renderForgeProgress(error.message);
      else showNotice(error.message, 'error');
    } finally {
      forgeRunning = false;
    }
  }

  function renderForgeAssistant(parent) {
    const toolbar = element('div', 'lsa-toolbar');
    toolbar.append(element('strong', 'lsa-title', '熔铸助手'));
    const targetLabel = element('label', '', '目标 ');
    const target = element('select');
    for (const rarity of ['SR', 'SSR']) {
      const option = element('option', '', rarity);
      option.value = rarity;
      target.append(option);
    }
    target.value = state.settings.forgeTarget;
    targetLabel.append(target);
    const keepLabel = element('label');
    const keep = element('input');
    keep.type = 'checkbox';
    keep.checked = state.settings.forgeKeepOne !== false;
    keepLabel.append(keep, element('span', '', '每种保留 1 个'));
    const button = element('button', 'lsa-primary lsa-small-button', '一键熔铸');
    toolbar.append(targetLabel, keepLabel, button);
    parent.append(toolbar);
    let excluded = new Set(state.settings.forgeExcludedNames);
    let preview = null;
    let exclusionSummary = null;
    const collect = () => ({ excludedNames: [...excluded], keepOne: keep.checked });
    const updatePreview = () => {
      const sequence = forgeSequencePreview(target.value, collect());
      if (preview) preview.textContent = sequence.summary;
      button.disabled = Boolean(forgeTask) || !state.userId || !sequence.stages.some(plan => plan.cycles > 0);
      target.disabled = Boolean(forgeTask);
      keep.disabled = Boolean(forgeTask);
      parent.querySelectorAll('.lsa-forge-exclusion-items input').forEach(input => { input.disabled = Boolean(forgeTask); });
      if (exclusionSummary) exclusionSummary.textContent = `排除 ${excluded.size} 项 · 查看预估`;
    };
    const persist = async (patch) => {
      state.settings = { ...state.settings, ...patch };
      updatePreview();
      try { await store.request('SETTINGS', { userId: state.userId, patch }); }
      catch (error) { showNotice(error.message, 'error'); }
    };
    target.addEventListener('change', () => persist({ forgeTarget: target.value }));
    keep.addEventListener('change', () => persist({ forgeKeepOne: keep.checked }));
    const extra = details('forge-options', `排除 ${excluded.size} 项 · 查看预估`, body => {
      const list = element('div', 'lsa-forge-exclusion-items');
      const titles = new Map(state.current.titles.filter(item => ['N', 'R', 'SR'].includes(item.rarity)).map(item => [item.name, item]));
      for (const name of excluded) if (!titles.has(name)) titles.set(name, { name, rarity: '' });
      for (const item of titles.values()) {
        const label = element('label', 'lsa-forge-exclusion-item');
        const input = element('input');
        input.type = 'checkbox'; input.value = item.name; input.checked = excluded.has(item.name);
        input.addEventListener('change', () => {
          if (input.checked) excluded.add(item.name); else excluded.delete(item.name);
          persist({ forgeExcludedNames: [...excluded] });
        });
        label.append(input, element('span', '', `${item.rarity} ${item.name}`.trim()));
        list.append(label);
      }
      preview = element('div', 'lsa-forge-preview');
      body.append(list, preview);
      updatePreview();
    });
    exclusionSummary = extra.querySelector('summary');
    parent.append(extra);
    button.addEventListener('click', () => showForgeConfirm(target.value, collect(), forgeSequencePreview(target.value, collect())));
    syncForgeControls = () => {
      target.value = state.settings.forgeTarget;
      keep.checked = state.settings.forgeKeepOne !== false;
      excluded = new Set(state.settings.forgeExcludedNames);
      extra.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = excluded.has(input.value); });
      updatePreview();
    };
    updatePreview();
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
    notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    if (kind !== 'error') window.setTimeout(() => notice.remove(), 8000);
  }

  function clearConfirm() {
    const current = panel && panel.querySelector('.lsa-confirm');
    if (current) current.remove();
  }

  function showDrawConfirm(form, action, userId) {
    clearConfirm();
    const { cost, label: modeLabel } = action;
    const confirm = element('div', 'lsa-confirm');
    confirm.append(element('div', 'lsa-confirm-text', `确认${modeLabel}？本次将消耗 ${formatNumber(cost)} 积分。`));
    const hint = element('div', 'lsa-muted', '普通抽取只保留积分统计，余额保护仍然生效。');
    confirm.append(hint);
    const actions = element('div', 'lsa-confirm-actions');
    const cancel = element('button', 'lsa-small-button', '取消');
    const submit = element('button', 'lsa-small-button lsa-primary', '确认抽取');
    cancel.type = submit.type = 'button';
    cancel.addEventListener('click', clearConfirm);
    submit.addEventListener('click', () => {
      submit.disabled = true;
      prepareDraw(form, action.button, { userId, cost, dialog: confirm }).finally(() => { submit.disabled = false; });
    });
    actions.append(cancel, submit);
    confirm.append(actions);
    panel.append(confirm);
  }

  async function prepareDraw(form, submitter, confirmed) {
    if (drawCheckPending) return;
    drawCheckPending = true;
    try {
      const action = parser.parseDrawAction(form, submitter);
      if (!action) throw new Error('未识别到本次抽取费用，请刷新论坛页面后重试；如果仍出现，请反馈抽取按钮上的费用文字。');
      if (!form.isConnected || action.button.matches(':disabled')) throw new Error('站点暂不允许本次抽取，请刷新页面后重试。');
      const userId = await requireAccount();
      if (confirmed && (confirmed.userId !== userId || confirmed.cost !== action.cost)) {
        clearConfirm();
        throw new Error('账号或抽取费用已变化，请重新点击抽取并确认。');
      }
      showNotice('正在核对当前账号和积分…');
      // Draw eligibility only needs a fresh balance; inventory/history requests
      // must not leave a newly installed extension with a permanently null balance.
      const doc = await fetchDocument('/gacha');
      if (parser.findUserId(doc) !== userId || parser.findUserId(document) !== userId) {
        throw new Error('登录账号已变化，请刷新论坛页面后重新抽取。');
      }
      const points = parser.parseGachaPage(doc)?.points;
      if (!Number.isFinite(points)) throw new Error('未识别到当前积分余额，请刷新论坛页面后重试。');
      state = await store.request('CURRENT', { userId, current: { points } });
      if (confirmed && !confirmed.dialog.isConnected) return;
      const latest = parser.parseDrawAction(form, action.button);
      if (parser.findUserId(document) !== userId || !form.isConnected || !latest || latest.cost !== action.cost) {
        clearConfirm();
        throw new Error('账号或抽取按钮已变化，请刷新论坛页面后重试。');
      }
      if (action.button.matches(':disabled')) throw new Error('站点暂不允许本次抽取，请刷新页面后重试。');
      const reserve = Math.max(0, Number(state.settings.reservePoints) || 0);
      if (points < action.cost) throw new Error(`积分不足：当前 ${formatNumber(points)} 分，本次需要 ${formatNumber(action.cost)} 分。`);
      if (points - action.cost < reserve) {
        throw new Error(`余额保护已阻止本次操作：当前 ${formatNumber(points)} 分，本次消耗 ${formatNumber(action.cost)} 分，需至少保留 ${formatNumber(reserve)} 分。`);
      }
      panel?.querySelector('.lsa-notice')?.remove();
      if (!confirmed && state.settings.confirmEachDraw) {
        showDrawConfirm(form, action, userId);
        return;
      }
      clearConfirm();
      approvedDraw = { form, button: action.button, userId, cost: action.cost };
      try {
        // Preserve the clicked submitter's name/value (single/ten/hundred).
        HTMLFormElement.prototype.requestSubmit.call(form, action.button);
      } finally {
        approvedDraw = null;
      }
    } catch (error) {
      showNotice(error.message || '暂时无法核对抽取信息，请稍后重试。', 'error');
    } finally {
      drawCheckPending = false;
    }
  }

  function attachDrawGuards() {
    document.querySelectorAll('.gacha-actions form').forEach((form) => {
      if (form.dataset.lsaGuardAttached === '1') return;
      form.dataset.lsaGuardAttached = '1';
      form.addEventListener('submit', (event) => {
        if (approvedDraw?.form === form) {
          const approval = approvedDraw;
          approvedDraw = null;
          const action = parser.parseDrawAction(form, event.submitter);
          if (action?.button === approval.button && action.cost === approval.cost
            && parser.findUserId(document) === approval.userId) return;
          event.preventDefault();
          showNotice('抽取信息已变化，请重新点击抽取并确认。', 'error');
          return;
        }
        event.preventDefault();
        void prepareDraw(form, event.submitter);
      });
    });
  }

  async function fetchDocument(url) {
    const expected = await requireAccount();
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (parser.findUserId(doc) !== expected) throw new Error('登录状态或账号已变化，请刷新页面；原账号数据已保留');
    return doc;
  }

  async function fetchProfile() {
    const doc = await fetchDocument('/gacha_profile');
    if (!doc.querySelector('.gacha-center-stat')) throw new Error('无法识别称号库存页面，本地库存已保留');
    const profile = parser.parseProfilePage(doc);
    if (profile.ownedTypes > 0 && !profile.inventory.length) throw new Error('库存解析不完整，请稍后重试');
    return profile;
  }

  async function refreshCurrentData() {
    const userId = await requireAccount();
    // Current HTML can be stale in a long-lived tab, so always fetch a fresh snapshot.
    const [gachaDoc, profile] = await Promise.all([fetchDocument('/gacha'), fetchProfile()]);
    const page = parser.parseGachaPage(gachaDoc);
    if (page.points === null || !page.titles.length) throw new Error('无法识别抽取页面，本地快照已保留');
    state = await store.request('CURRENT', { userId, current: {
      points: page.points, pool: page.pool, titles: page.titles,
      ownedTypes: profile.ownedTypes, totalTypes: page.totalTypes, inventory: profile.inventory
    } });
    return profile;
  }

  async function syncHistory(rebuild = false) {
    const userId = await requireAccount();
    const initial = await store.request('GET', { userId });
    const payload = { userId, generation: initial.historyGeneration, rebuild, sync: {} };
    const failures = [];
    for (const [tab, key, parse, label] of [
      ['points_rewards', 'historyRows', parser.parsePointsHistoryPage, '积分流水'],
      ['notifications', 'forgeEvents', parser.parseNotificationPage, '熔铸通知']
    ]) {
      try {
        const result = await globalThis.LinuxSbHistory.collectPages({
          firstUrl: `${location.origin}/user/${userId}?tab=${tab}&p=1`,
          fetchPage: async url => {
            const doc = await fetchDocument(url);
            const selector = tab === 'points_rewards' ? '.points-rewards-detail' : '.notification-item';
            if (!doc.querySelector(selector) && !/暂无|没有.*(?:记录|通知|流水)|尚无|空空如也/.test(parser.textOf(doc.querySelector('main')))) {
              throw new Error('未识别到记录列表，本地历史已保留');
            }
            return doc;
          },
          parsePage: parse, pageUrls: (doc, url) => parser.parsePaginationUrls(doc, url, tab),
          known: initial[key], incremental: !rebuild && initial.sync[key]?.complete === true,
          key: store.recordKey,
          onProgress: (page, total) => showNotice(`正在更新${label} ${page}/${total} 页…`)
        });
        payload[key] = store.mergeRecords([], result.rows);
        payload.sync[key] = {
          updatedAt: new Date().toISOString(), pages: result.pages, mode: result.mode,
          complete: result.reachedEnd || initial.sync[key]?.complete === true,
          firstTime: result.rows[0]?.time || '', lastTime: result.rows.at(-1)?.time || '', error: ''
        };
      } catch (error) {
        failures.push(`${label}：${error.message}`);
        payload.sync[key] = { ...initial.sync[key], error: error.message };
      }
    }
    state = await store.request('HISTORY', payload);
    if (failures.length) throw new Error(`部分更新未完成。${failures.join('；')}`);
  }

  function updateData(rebuild = false) {
    if (updatePromise) return updatePromise;
    updatePromise = (async () => {
      panel?.querySelectorAll('[data-update]').forEach(button => { button.disabled = true; });
      let snapshotError = null;
      try { await refreshCurrentData(); } catch (error) { snapshotError = error; }
      try {
        await syncHistory(rebuild);
        if (snapshotError) throw snapshotError;
        render();
        showNotice(rebuild ? '已完整重建站点当前可访问的历史。' : '数据已更新。');
      } catch (error) {
        render();
        showNotice(error.message, 'error');
        throw error;
      } finally {
        updatePromise = null;
        panel?.querySelectorAll('[data-update]').forEach(button => { button.disabled = false; });
      }
      return state;
    })();
    return updatePromise;
  }

  function createPanel() {
    const root = element('section', 'linux-sb-title-assistant');
    root.id = 'linux-sb-title-assistant';
    panel = root;
    return root;
  }

  function findTitleTabBar(target) {
    const labels = /我的称号|称号抽取|称号熔炼|称号回收|UR\s*合成|称号交易/;
    const selectors = [
      '.gacha-tabs', '.gacha-tab-bar', '.gacha-nav', '.gacha-page-tabs',
      '[role="tablist"]', '.tab-bar'
    ];
    const roots = [...new Set([target, target.parentElement, target.closest('main'), document.body].filter(Boolean))];
    const candidates = [];
    for (const root of roots) {
      for (const selector of selectors) candidates.push(...root.querySelectorAll(selector));
      candidates.push(...root.querySelectorAll('nav, [class*="tab"], [class*="tabs"]'));
    }
    const unique = [...new Set(candidates)];
    return unique
      .map((node) => {
        const controls = node.querySelectorAll('a, button, [role="tab"]');
        const matched = [...controls].filter((control) => labels.test(control.textContent || '')).length;
        return { node, matched, controls: controls.length };
      })
      .filter((item) => item.matched >= 2)
      .sort((a, b) => b.matched - a.matched || b.controls - a.controls)[0]?.node || null;
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
      const tabBar = findTitleTabBar(target);
      if (tabBar) tabBar.insertAdjacentElement('afterend', root);
      else target.prepend(root);
    }
  }

  function render() {
    if (!panel) mountPanel();
    panel.replaceChildren();
    if (isForgePage) {
      renderForgeAssistant(panel);
      renderForgeProgress();
      return;
    }
    const summary = parser.summarizeHistory(state.historyRows);
    const toolbar = element('div', 'lsa-toolbar');
    toolbar.append(element('strong', 'lsa-title', '称号统计'));
    toolbar.append(element('span', 'lsa-inline-stat', `积分 ${formatNumber(state.current.points)}`));
    toolbar.append(element('span', 'lsa-inline-stat', `收集 ${state.current.ownedTypes ?? '—'}/${state.current.totalTypes ?? '—'}`));
    const update = element('button', 'lsa-small-button', '更新数据');
    update.dataset.update = '1'; update.disabled = Boolean(updatePromise);
    update.addEventListener('click', () => updateData().catch(() => {}));
    toolbar.append(update);
    panel.append(toolbar);
    panel.append(details('statistics', `详细统计 · ${formatNumber(summary.totalPulls)} 抽 · 投入 ${formatNumber(summary.totalSpend)} 分`, body => {
      const range = element('div', 'lsa-muted');
      const times = state.historyRows.map(row => row.time).filter(Boolean).sort();
      const status = state.sync.historyRows;
      range.textContent = status?.updatedAt
        ? `上次同步 ${new Date(status.updatedAt).toLocaleString('zh-CN')} · ${status.complete ? '已遍历可访问历史' : '历史尚不完整'}${times.length ? ` · ${times[0]} 至 ${times.at(-1)}` : ''}${status.error ? ' · 最近同步失败' : ''}`
        : '尚未同步历史';
      body.append(range);
      body.append(details('inventory', `当前库存 · ${state.current.inventory.length} 种`, renderInventory));
      body.append(details('missing', `未收集 · ${missingTitles().length} 种`, renderMissing));
      renderHistorySummary(body);
      renderScoreSummary(body);
      const rebuild = element('button', 'lsa-small-button', '完整重建历史');
      rebuild.dataset.update = '1'; rebuild.disabled = Boolean(updatePromise);
      rebuild.addEventListener('click', () => updateData(true).catch(() => {}));
      body.append(rebuild, element('div', 'lsa-muted', '重新读取站点所有可访问记录；成功后替换该账号本地历史。'));
    }));
  }

  async function handleMessage(message) {
    if (message?.type === 'GET_SNAPSHOT') return { ok: true, state };
    if (message?.type === 'UPDATE_DATA') {
      try { await updateData(); return { ok: true, state }; }
      catch (error) { return { ok: false, error: error.message }; }
    }
    return { ok: false };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true;
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY] || !state) return;
    const root = store.normalize(changes[STORAGE_KEY].newValue);
    const next = store.snapshot(root, state.userId);
    const dataChanged = JSON.stringify([state.current, state.historyRows, state.forgeEvents, state.sync]) !== JSON.stringify([next.current, next.historyRows, next.forgeEvents, next.sync]);
    state = next;
    forgeTask = next.pendingForge;
    if (!panel) return;
    if (isForgePage) {
      syncForgeControls();
      renderForgeProgress();
    } else if (dataChanged && !updatePromise) {
      // Defer data refresh while a confirmation or a focused control is in use.
      if (!panel.querySelector('.lsa-confirm') && !panel.contains(document.activeElement)) render();
    }
  });

  (async function init() {
    state = await loadState();
    forgeTask = state.pendingForge;
    mountPanel();
    render();
    if (isGachaPage) attachDrawGuards();
    try {
      await refreshCurrentData();
      if (!panel.querySelector('.lsa-confirm')) render();
      if (isForgePage) await resumeForgeChain();
    } catch (error) {
      showNotice(error.message, 'error');
    }
  })().catch(error => { if (panel) showNotice(error.message, 'error'); });
})();
