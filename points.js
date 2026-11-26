(function () {
  'use strict';
  const api = globalThis.LinuxSbPoints;
  const store = globalThis.LinuxSbState;
  const parser = globalThis.LinuxSbTitleStats;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let accountId = /^\d+$/.test(params.get('account') || '') ? params.get('account') : '';
  let followLogin = !accountId;
  let snapshot = null, rows = [], selectedRows = [], filtered = [], page = 1, preset = '30';
  let mode = params.get('mode') === 'week' ? 'week' : 'day';
  let controller = null, loadVersion = 0, insightFilter = null;
  const PAGE_SIZE = 25;
  if (mode === 'week') preset = '90';
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function message(text, error = false) { $('message').textContent = text; $('message').hidden = !text; $('message').classList.toggle('error', error); }
  function timeText(value) {
    if (!value) return '—';
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return text.replace('T', ' ');
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: api.TIME_ZONE, hour12: false }) : text;
  }
  function applyPreset(value) {
    preset = value;
    const today = api.dayKey(new Date());
    const days = rows.map(row => row.day).filter(Boolean).sort();
    $('startDate').value = value === 'all' ? (days[0] || today) : api.addDays(today, 1 - Number(value));
    $('endDate').value = value === 'all' && days.at(-1) > today ? days.at(-1) : today;
    for (const button of $('presets').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.days === value));
  }
  function renderBreakdown(id, kind, total) {
    const groups = api.groups(selectedRows).filter(group => group[kind] > 0).sort((a, b) => b[kind] - a[kind]);
    $(id).replaceChildren();
    $(kind === 'income' ? 'incomeTypes' : 'expenseTypes').textContent = `${groups.length} 种来源`;
    if (!groups.length) { $(id).append(element('div', 'breakdown-empty', `此期间暂无${kind === 'income' ? '获取' : '消耗'}记录`)); return; }
    for (const group of groups) {
      const button = element('button', 'breakdown-row'); button.type = 'button';
      button.setAttribute('aria-label', `筛选${group.name}${kind === 'income' ? '获取' : '消耗'}明细`);
      button.title = `${group.name} · ${group.count} 笔记录 · 点击筛选逐笔明细`;
      const line = element('span', 'breakdown-line');
      const share = group[kind] / total * 100;
      line.append(element('span', 'breakdown-name', group.name), element('span', 'breakdown-count', `${group.count} 笔`), element('span', 'breakdown-amount', api.format(group[kind])), element('span', 'breakdown-share', `${share < 0.1 ? '<0.1' : share.toFixed(1)}%`));
      const track = element('span', 'breakdown-track'), bar = element('span', 'breakdown-bar');
      track.style.display = 'block'; bar.style.width = `${share}%`; track.append(bar); button.append(line, track);
      button.addEventListener('click', () => {
        showLedger({ kind: 'category', category: group.name, direction: kind, label: `${group.name} · ${kind === 'income' ? '获取' : '消耗'}` });
      });
      $(id).append(button);
    }
  }
  function renderLedger() {
    const query = $('search').value.trim().toLocaleLowerCase();
    filtered = selectedRows.filter(row => (!query || `${row.reason} ${row.relatedTitle || ''}`.toLocaleLowerCase().includes(query))
      && insightMatches(row)
      && (!$('category').value || ($('category').value.startsWith('group:') ? row.categoryGroup === $('category').value.slice(6) : row.category === $('category').value))
      && (!$('direction').value || ($('direction').value === 'income' ? row.amount > 0
        : $('direction').value === 'expense' ? row.amount !== null && row.amount < 0
          : $('direction').value === 'zero' ? row.amount === 0 : row.amount === null)))
      .sort((a, b) => {
        const sortable = row => /^\d{4}-\d{2}-\d{2}/.test(row.time) ? row.time : row.day;
        return String(sortable(b)).localeCompare(String(sortable(a)));
      });
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); page = Math.min(page, pages);
    $('ledgerRows').replaceChildren();
    for (const row of filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const tr = element('tr');
      const type = element('td');
      const chip = element('span', `category-chip${row.classification.needsReview ? ' needs-review' : ''}`, row.category);
      chip.title = `${row.categoryGroup} · ${row.classification.status}\n${row.classification.evidence}`;
      type.append(chip, element('small', 'category-parent', row.categoryGroup));
      if (row.classification.needsReview && row.category !== '待分类') type.append(element('small', 'review-label', row.classification.status));
      const reason = element('td', 'reason-cell'); reason.append(element('span', '', row.reason));
      if (row.relatedUrl && /^https:\/\/linux\.sb\/topic\/\d+(?:\?|$)/.test(row.relatedUrl)) {
        const link = element('a', 'related-topic', row.relatedTitle || '查看关联主题 ↗');
        link.href = row.relatedUrl; link.target = '_blank'; link.rel = 'noopener'; reason.append(link);
      }
      const amount = element('td', `amount-cell ${row.amount > 0 ? 'income-text' : row.amount < 0 ? 'expense-text' : ''}`, row.amount === null ? '待识别' : api.signed(row.amount));
      tr.append(element('td', '', timeText(row.time)), type, reason, amount);
      $('ledgerRows').append(tr);
    }
    $('ledgerEmpty').hidden = filtered.length > 0;
    $('pageLabel').textContent = `${page} / ${pages}`;
    $('previousPage').disabled = page === 1; $('nextPage').disabled = page === pages;
    $('ledgerSummary').textContent = `共 ${api.format(filtered.length)} 笔符合条件的记录 · 按时间倒序`;
    const total = api.summary(filtered);
    $('filteredTotals').textContent = `筛选合计：获取 ${api.format(total.income)} · 消耗 ${api.format(total.expense)} · 净变化 ${api.signed(total.net)}`;
    $('exportCsv').disabled = !filtered.length;
    $('insightFilter').hidden = !insightFilter;
    $('insightFilterLabel').textContent = insightFilter?.label || '';
  }
  function insightMatches(row) {
    if (!insightFilter) return true;
    if (insightFilter.kind === 'person') return row.counterparty?.name === insightFilter.name && row.counterparty.direction === insightFilter.direction;
    if (insightFilter.kind === 'topic') return api.isTopicIncome(row) && row.topic.id === insightFilter.id;
    if (insightFilter.kind === 'day') return row.day === insightFilter.day;
    if (insightFilter.kind === 'families') return insightFilter.names.includes(row.categoryGroup);
    if (insightFilter.kind === 'category') return row.category === insightFilter.category;
    return true;
  }
  function clearLedgerFilter() {
    insightFilter = null; $('search').value = ''; $('category').value = ''; $('direction').value = ''; page = 1;
    renderLedger();
  }
  function showLedger(filter) {
    insightFilter = filter; $('search').value = ''; $('category').value = filter.category || ''; $('direction').value = filter.direction || ''; page = 1;
    renderLedger();
    $('ledgerTitle').scrollIntoView({ block: 'start' });
  }
  function render() {
    if (!snapshot) return;
    const start = $('startDate').value, end = $('endDate').value;
    selectedRows = preset === 'all' ? rows : api.inRange(rows, start, end);
    const total = api.summary(selectedRows), complete = snapshot.sync.pointsRows?.complete === true;
    $('balance').textContent = snapshot.current.points === null ? '—' : api.format(snapshot.current.points);
    $('balanceTime').textContent = snapshot.updatedAt ? `${timeText(snapshot.updatedAt)} 更新` : '尚未更新余额';
    $('income').textContent = api.format(total.income); $('expense').textContent = api.format(total.expense); $('net').textContent = api.signed(total.net);
    $('net').classList.toggle('income-text', total.net > 0); $('net').classList.toggle('expense-text', total.net < 0);
    $('incomeCount').textContent = `${api.format(selectedRows.filter(row => row.amount > 0).length)} 笔获取记录`;
    $('expenseCount').textContent = `${api.format(selectedRows.filter(row => row.amount !== null && row.amount < 0).length)} 笔消耗记录`;
    $('trendRange').textContent = `${start} — ${end}${mode === 'week' ? ' · 首尾周按所选日期统计' : ''}`;
    $('trendEmpty').hidden = rows.length > 0;
    $('trendChart').hidden = !rows.length;
    $('trendEmpty').querySelector('strong').textContent = complete ? '已同步，暂时没有积分流水' : '这里将呈现你的积分轨迹';
    for (const button of $('chartMode').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    globalThis.LinuxSbPointsChart.render($('trendChart'), api.buckets(selectedRows, { start, end, mode }), { mode });
    renderBreakdown('incomeBreakdown', 'income', total.income); renderBreakdown('expenseBreakdown', 'expense', total.expense);
    const oldCategory = $('category').value;
    $('category').replaceChildren(new Option('全部类型', ''));
    const families = [...new Set(rows.map(row => row.categoryGroup))].sort();
    for (const family of families) {
      const group = element('optgroup'); group.label = family;
      group.append(new Option(`${family} · 全部`, `group:${family}`));
      for (const name of [...new Set(rows.filter(row => row.categoryGroup === family).map(row => row.category))].sort()) group.append(new Option(name, name));
      $('category').append(group);
    }
    if ([...$('category').options].some(option => option.value === oldCategory)) $('category').value = oldCategory;
    $('sourceLink').href = accountId ? `https://linux.sb/user/${accountId}?tab=points_rewards` : 'https://linux.sb/';
    const meta = snapshot.sync.pointsRows;
    $('coverageDot').classList.toggle('complete', complete && !meta?.error);
    $('coverage').textContent = meta?.updatedAt ? `账号 ${accountId} · 已同步 ${api.format(rows.length)} 笔 · ${timeText(meta.updatedAt)}${complete ? ' · 已遍历可访问历史' : ' · 历史尚未完整'}` : '尚未同步全部积分流水；旧版称号历史不会充当完整收支。';
    const issues = api.summary(rows);
    $('dataNote').textContent = `统计基于论坛可访问的流水；类型按原因归类，原始原因完整保留。当前余额为独立快照。${issues.undated ? ` ${issues.undated} 笔时间未识别，仅在“全部”中计入总额和明细，不计入趋势。` : ''}${issues.invalid ? ` ${issues.invalid} 笔金额待识别，保留明细，不计入金额合计。` : ''}${meta?.error ? ` 最近同步失败：${meta.error}` : ''}`;
    globalThis.LinuxSbPointsInsights.render({ rows: selectedRows, start, end, onFilter: showLedger });
    renderLedger();
  }
  async function loadAccounts(legacy = false) {
    const ids = legacy ? [] : await store.request('ACCOUNTS');
    if (accountId && !ids.includes(accountId)) ids.push(accountId);
    $('account').replaceChildren();
    $('account').add(new Option('当前登录账号（自动识别）', ''));
    for (const id of ids) $('account').add(new Option(`账号 ${id}`, id));
    $('account').value = followLogin ? '' : accountId;
  }
  async function load(resetRange = false) {
    const version = ++loadVersion;
    const next = await store.request('GET', accountId ? { userId: accountId } : {});
    if (version !== loadVersion) return;
    snapshot = next;
    accountId = snapshot.userId; rows = api.records(snapshot.pointsRows);
    const legacy = snapshot.pointsProtocol !== 1;
    await loadAccounts(legacy);
    if (version !== loadVersion) return;
    if (resetRange || !$('startDate').value) applyPreset(preset);
    else if (preset === 'all') applyPreset('all');
    render();
    $('reloadExtension').hidden = !legacy;
    if (legacy) throw new Error('扩展后台尚未加载新版积分接口。请点击“重新加载扩展”，然后刷新本页；账号数据会保留。');
  }
  async function synchronize() {
    if (controller) { controller.abort(); return; }
    if (snapshot?.pointsProtocol !== 1) { message('请先重新加载扩展，再刷新本页后同步。', true); $('reloadExtension').hidden = false; return; }
    controller = new AbortController();
    const signal = controller.signal;
    $('syncPoints').textContent = '停止同步'; $('account').disabled = true;
    let initial = null, syncUserId = '';
    const expectedAccount = followLogin ? '' : accountId;
    message('正在确认登录账号…');
    const fetchDoc = async url => {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
      if (!response.ok) throw new Error(`积分页面请求失败（${response.status}）`);
      const doc = new DOMParser().parseFromString(globalThis.LinuxSbMarket.inertHtml(await response.text()), 'text/html');
      const userId = parser.findUserId(doc);
      if (!userId) throw new Error('无法确认登录账号，请先在 linux.sb 登录');
      const expected = syncUserId || expectedAccount;
      if (expected && userId !== expected) throw new Error(`当前登录账号为 ${userId}，与统计账号 ${expected} 不同；可选择“当前登录账号（自动识别）”同步该账号，原账号历史会保留`);
      return doc;
    };
    try {
      const doc = await fetchDoc('https://linux.sb/gacha');
      syncUserId = parser.findUserId(doc);
      initial = await store.request('GET', { userId: syncUserId });
      const balance = parser.parseGachaPage(doc).points;
      const payload = await globalThis.LinuxSbPointsSync.collect({ snapshot: initial, fetchPage: fetchDoc,
        onProgress: (page, total) => message(`正在同步全部类型积分流水 · ${page} / ${total} 页。可以停止，已有记录会保留。`) });
      if (signal.aborted) throw new DOMException('已停止', 'AbortError');
      await store.request('HISTORY', { userId: syncUserId, generation: initial.historyGeneration, ...payload });
      if (balance !== null) await store.request('CURRENT', { userId: syncUserId, current: { points: balance } });
      accountId = syncUserId;
      await load();
      message(`同步完成，已保存 ${api.format(snapshot.pointsRows.length)} 笔全类型积分流水。${balance === null ? '此次未能读取余额，保留原快照。' : ''}`);
    } catch (error) {
      if (initial && !signal.aborted) {
        await store.request('HISTORY', { userId: syncUserId, generation: initial.historyGeneration,
          sync: { pointsRows: { ...initial.sync.pointsRows, error: error.message } } }).catch(() => {});
      }
      await load().catch(() => {});
      message(signal.aborted ? '已停止同步，原有积分流水保留。' : `同步未完成：${error.message}`, !signal.aborted);
    } finally { controller = null; $('syncPoints').textContent = '↻ 同步流水'; $('account').disabled = false; }
  }
  $('syncPoints').addEventListener('click', synchronize);
  $('account').addEventListener('change', () => { followLogin = !$('account').value; accountId = $('account').value; insightFilter = null; page = 1; message(''); load(true).catch(error => message(error.message, true)); });
  $('reloadExtension').addEventListener('click', () => { message('扩展正在重新加载；请刷新本页后继续同步。'); chrome.runtime.reload(); });
  $('clearInsightFilter').addEventListener('click', clearLedgerFilter);
  $('presets').addEventListener('click', event => { const days = event.target.closest('button')?.dataset.days; if (days) { page = 1; applyPreset(days); render(); } });
  $('dateForm').addEventListener('submit', event => {
    event.preventDefault();
    const start = $('startDate').value, end = $('endDate').value;
    if (!api.validDay(start) || !api.validDay(end) || start > end) { message('请选择有效日期，开始日期不能晚于结束日期。', true); return; }
    preset = ''; page = 1; message('');
    for (const button of $('presets').querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
    render();
  });
  $('chartMode').addEventListener('click', event => { const next = event.target.closest('button')?.dataset.mode; if (next) { mode = next; render(); } });
  for (const id of ['search', 'category', 'direction']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 1; renderLedger(); });
  $('resetFilters').addEventListener('click', clearLedgerFilter);
  $('previousPage').addEventListener('click', () => { page--; renderLedger(); });
  $('nextPage').addEventListener('click', () => { page++; renderLedger(); });
  $('exportCsv').addEventListener('click', () => {
    // Quote and neutralise spreadsheet formulas in all source-controlled text fields.
    const cell = value => typeof value === 'number' ? String(value) : `"${String(value).replace(/^[\s]*[=+\-@]/, text => `'${text}`).replace(/"/g, '""')}"`;
    const csv = [['时间', '来源大类', '详细类型', '积分原因', '变动积分', '解析状态', '分类依据', '关联主题', '主题链接', '打赏对方', '打赏方向'], ...filtered.map(row => [row.time, row.categoryGroup, row.category, row.reason, row.amount ?? '待识别', row.classification.status, row.classification.evidence, row.relatedTitle || '', row.relatedUrl || '', row.counterparty?.name || '', row.counterparty?.direction === 'income' ? '收到' : row.counterparty?.direction === 'expense' ? '送出' : ''])]
      .map(row => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = element('a'); anchor.href = url; anchor.download = `积分流水-${accountId}-${$('startDate').value}-${$('endDate').value}.csv`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[store.STORAGE_KEY] && !controller) load().catch(error => message(error.message, true));
  });
  applyPreset(preset);
  load(true).catch(error => message(`读取积分数据失败：${error.message}`, true));
})();
