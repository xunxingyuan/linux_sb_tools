(function (global) {
  'use strict';
  const api = global.LinuxSbPoints;
  const $ = id => document.getElementById(id);
  const expanded = { income: false, expense: false };
  let state = null, compositionMode = 'income';
  function node(tag, className, text) {
    const el = document.createElement(tag); if (className) el.className = className;
    if (text !== undefined) el.textContent = text; return el;
  }
  function svgNode(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text; return el;
  }
  function empty(container, text) { container.append(node('p', 'widget-empty', text)); }
  function renderPeople(direction) {
    const incoming = direction === 'income', prefix = incoming ? 'received' : 'sent';
    const data = api.people(state.rows, direction), list = $(`${prefix}People`);
    list.replaceChildren();
    $(`${prefix}Summary`).textContent = `${data.leaders.length} 位用户 · ${data.count} 笔 · ${api.format(data.amount)} 分`;
    const shown = expanded[direction] ? data.leaders : data.leaders.slice(0, 6);
    for (const [index, person] of shown.entries()) {
      const button = node('button', 'person-row'); button.type = 'button';
      button.setAttribute('aria-label', `查看${incoming ? '来自' : '送给'}${person.name}的打赏流水`);
      const share = person.amount / data.amount * 100;
      const shareLabel = `${share < 0.1 ? '<0.1' : share.toFixed(1)}%`;
      button.title = `${person.name} · ${api.format(person.amount)} 分 · ${person.count} 笔 · 占 ${shareLabel}`;
      const avatar = node('span', `person-avatar tone-${index % 4}`, [...person.name][0]); avatar.setAttribute('aria-hidden', 'true');
      const main = node('span', 'person-main');
      main.append(node('span', 'person-name', person.name));
      const track = node('span', 'person-track'), bar = node('span', 'person-bar');
      bar.style.width = `${person.amount / data.leaders[0].amount * 100}%`; track.append(bar); main.append(track);
      const value = node('span', 'person-value'); value.append(node('strong', '', api.format(person.amount)), node('small', '', `${person.count} 笔 · ${shareLabel}`));
      button.append(node('span', `rank-number${index < 3 ? ' top-rank' : ''}`, String(index + 1).padStart(2, '0')), avatar, main, value);
      button.addEventListener('click', () => state.onFilter({ kind: 'person', name: person.name, direction,
        label: `${incoming ? '来自' : '送给'} ${person.name} 的打赏` }));
      list.append(button);
    }
    if (!shown.length) empty(list, '此期间暂无可明确归属用户的直接打赏。');
    const more = $(`${prefix}More`); more.hidden = data.leaders.length <= 6;
    more.textContent = expanded[direction] ? '收起排行 ↑' : `查看全部 ${data.leaders.length} 位用户 ↓`;
    more.onclick = () => { expanded[direction] = !expanded[direction]; renderPeople(direction); };
    $(`${prefix}Note`).textContent = `按流水中的昵称汇总，仅计直接打赏。${data.unattributedCount ? `另有 ${data.unattributedCount} 笔（${api.format(data.unattributedAmount)} 分）未明确归属，不计入排行。` : '不含系统奖励、幸运打赏奖励、红包及交易。'}`;
  }
  function renderComposition() {
    const { total, segments } = api.composition(state.rows, compositionMode);
    const palette = compositionMode === 'income' ? ['#4978ed', '#79a9f7', '#65b6b1', '#9c91db', '#afc8ee', '#dce4f0'] : ['#e5a34d', '#f3c172', '#e8a48a', '#bca1cb', '#e8d0a3', '#e8e1d8'];
    const chart = $('compositionChart'), legend = $('compositionLegend'); chart.replaceChildren(); legend.replaceChildren();
    const svg = svgNode('svg', { viewBox: '0 0 160 160', role: 'img', 'aria-label': `${compositionMode === 'income' ? '获取' : '消耗'}来源构成，总计 ${api.format(total)} 积分` });
    svg.append(svgNode('circle', { cx: 80, cy: 80, r: 59, fill: 'none', stroke: '#f0f3f8', 'stroke-width': 16 }));
    let offset = 0; const circumference = 2 * Math.PI * 59;
    for (const [index, segment] of segments.entries()) {
      const length = segment.amount / total * circumference;
      const arc = svgNode('circle', { cx: 80, cy: 80, r: 59, fill: 'none', stroke: palette[index], 'stroke-width': 16,
        'stroke-dasharray': `${length} ${circumference - length}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 80 80)' });
      arc.append(svgNode('title', {}, `${segment.name}：${api.format(segment.amount)} 分`)); svg.append(arc); offset += length;
      const button = node('button', 'composition-item'); button.type = 'button';
      const dot = node('i'); dot.style.background = palette[index];
      button.append(dot, node('span', 'composition-name', segment.name), node('span', 'composition-share', `${(segment.amount / total * 100).toFixed(1)}%`));
      button.title = `${segment.name}：${api.format(segment.amount)} 分；点击筛选`;
      button.addEventListener('click', () => state.onFilter({ kind: 'families', names: segment.groups, direction: compositionMode,
        label: `${segment.name} · ${compositionMode === 'income' ? '获取' : '消耗'}` }));
      legend.append(button);
    }
    svg.append(svgNode('text', { x: 80, y: 78, 'text-anchor': 'middle', class: 'donut-total' }, api.format(total)),
      svgNode('text', { x: 80, y: 98, 'text-anchor': 'middle', class: 'donut-caption' }, compositionMode === 'income' ? '期间获取' : '期间消耗'));
    chart.append(svg);
    if (!segments.length) empty(legend, '此期间暂无收支');
    for (const button of $('compositionMode').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.direction === compositionMode));
  }
  function renderTopics() {
    const topics = api.topics(state.rows), list = $('topicRanking'); list.replaceChildren();
    $('topicsSummary').textContent = `${topics.length} 个关联主题${topics.length > 6 ? ' · 展示前 6' : ''} · 获取 ${api.format(topics.reduce((sum, topic) => sum + topic.amount, 0))} 分`;
    for (const [index, topic] of topics.slice(0, 6).entries()) {
      const row = node('div', 'topic-entry'), button = node('button', 'topic-row'); button.type = 'button';
      button.setAttribute('aria-label', `查看主题 ${topic.title} 的积分流水`);
      const main = node('span', 'topic-main'); main.append(node('span', 'topic-name', topic.title));
      const track = node('span', 'person-track'), bar = node('span', 'person-bar'); bar.style.width = `${topic.amount / topics[0].amount * 100}%`; track.append(bar); main.append(track);
      const value = node('span', 'person-value'); value.append(node('strong', '', api.format(topic.amount)), node('small', '', `${topic.count} 笔`));
      button.append(node('span', 'rank-number', String(index + 1).padStart(2, '0')), main, value);
      button.addEventListener('click', () => state.onFilter({ kind: 'topic', id: topic.id, direction: 'income', label: `关联主题：${topic.title}` }));
      const link = node('a', 'topic-open', '↗'); link.href = topic.url; link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-label', `打开主题 ${topic.title}`);
      row.append(button, link); list.append(row);
    }
    if (!topics.length) empty(list, '当前流水未包含可统计的关联主题链接。');
  }
  function renderActivity() {
    const stats = api.activity(state.rows, state), container = $('activityCalendar'); container.replaceChildren();
    const earliest = api.addDays(api.weekStart(state.end), -105);
    const start = state.start < earliest ? earliest : state.start;
    const first = api.weekStart(start), last = api.addDays(api.weekStart(state.end), 6);
    const columns = Math.round(((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000 + 1) / 7);
    $('activityRange').textContent = `${start} — ${state.end} · 流水笔数${start !== state.start ? ' · 最近 16 周' : ''}`;
    const labels = node('div', 'calendar-weekdays');
    for (const text of ['一', '二', '三', '四', '五', '六', '日']) labels.append(node('span', '', text));
    const body = node('div', 'calendar-body'), months = node('div', 'calendar-months'), grid = node('div', 'calendar-grid');
    months.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    const days = new Map(stats.days.map(day => [day.day, day])), maximum = Math.max(1, ...stats.days.filter(day => day.day >= start).map(day => day.count));
    let previousMonth = '';
    for (let week = 0; week < columns; week++) {
      const weekDate = api.addDays(first, week * 7), month = weekDate.slice(0, 7);
      months.append(node('span', '', month !== previousMonth ? `${Number(weekDate.slice(5, 7))}月` : '')); previousMonth = month;
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const date = api.addDays(weekDate, dayIndex);
        if (date < start || date > state.end) { const blank = node('span', 'calendar-blank'); blank.setAttribute('aria-hidden', 'true'); grid.append(blank); continue; }
        const day = days.get(date) || { count: 0, income: 0, expense: 0 };
        const cell = node('button', 'calendar-day'); cell.type = 'button'; cell.dataset.day = date;
        cell.dataset.level = day.count ? String(Math.max(1, Math.ceil(day.count / maximum * 4))) : '0';
        const description = `${date}：${day.count} 笔，获取 ${api.format(day.income)}，消耗 ${api.format(day.expense)} 积分`;
        cell.title = description; cell.setAttribute('aria-label', description);
        cell.addEventListener('click', () => state.onFilter({ kind: 'day', day: date, label: `${date} 的积分流水` })); grid.append(cell);
      }
    }
    body.append(months, grid); container.append(labels, body);
    const footer = $('activityStats'); footer.replaceChildren();
    for (const [label, value, detail] of [
      ['活跃天数', `${stats.activeDays} / ${stats.dayCount}`, '所选日期范围'],
      ['日均净变化', api.signed(stats.averageNet), '含无流水日期'],
      ['单日最高获取', stats.bestDay ? api.format(stats.bestDay.income) : '—', stats.bestDay?.day || '暂无获取记录']
    ]) { const item = node('div'); item.append(node('span', '', label), node('strong', '', value), node('small', '', detail)); footer.append(item); }
  }
  function render(options) {
    state = options; renderPeople('income'); renderPeople('expense'); renderComposition(); renderTopics(); renderActivity();
  }
  $('compositionMode').addEventListener('click', event => {
    const direction = event.target.closest('button')?.dataset.direction;
    if (direction && state) { compositionMode = direction; renderComposition(); }
  });
  global.LinuxSbPointsInsights = { render };
})(globalThis);
