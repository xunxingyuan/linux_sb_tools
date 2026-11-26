(function (global) {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  let serial = 0;
  const observed = new WeakMap();
  const short = n => n >= 10000 ? `${+(n / 10000).toFixed(1)}万` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : global.LinuxSbPoints.format(n);
  function svgNode(name, attrs = {}, text) {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function render(container, buckets, { compact = false, mode = 'day' } = {}) {
    container.replaceChildren();
    const available = container.clientWidth || 720;
    const width = compact ? 306 : Math.max(available, buckets.length * 18 + 60);
    const height = compact ? 110 : 212;
    const left = compact ? 0 : 52, right = compact ? 0 : 15, top = compact ? 16 : 24, bottom = compact ? 22 : 34;
    const plotHeight = height - top - bottom;
    const maximum = Math.max(1, ...buckets.flatMap(b => [b.income, b.expense]));
    const magnitude = 10 ** Math.floor(Math.log10(maximum));
    const quantum = magnitude / 5;
    const ceiling = Math.ceil(maximum / quantum) * quantum;
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `积分${mode === 'week' ? '每周' : '每日'}获取和消耗柱状图`, class: 'points-svg' });
    if (!compact) { svg.style.width = `${width}px`; svg.style.height = `${height}px`; }
    const id = `points-gradient-${++serial}`;
    const defs = svgNode('defs');
    for (const [kind, colors] of [['income', ['#779cfb', '#3465e8']], ['expense', ['#f5c479', '#e6a047']]]) {
      const gradient = svgNode('linearGradient', { id: `${id}-${kind}`, x1: '0', y1: '0', x2: '0', y2: '1' });
      gradient.append(svgNode('stop', { offset: '0%', 'stop-color': colors[0] }), svgNode('stop', { offset: '100%', 'stop-color': colors[1] }));
      defs.append(gradient);
    }
    svg.append(defs);
    for (let step = 0; step <= (compact ? 2 : 4); step++) {
      const fraction = step / (compact ? 2 : 4), y = top + fraction * plotHeight;
      svg.append(svgNode('line', { x1: left, x2: width - right, y1: y, y2: y, stroke: '#e8edf5', 'stroke-dasharray': step ? '3 4' : '2 4' }));
      if (!compact) svg.append(svgNode('text', { x: left - 10, y: y + 4, 'text-anchor': 'end', class: 'points-axis' }, short(ceiling * (1 - fraction))));
    }
    if (compact) svg.append(svgNode('text', { x: width, y: 10, 'text-anchor': 'end', class: 'points-axis' }, short(ceiling)));
    const slot = (width - left - right) / Math.max(buckets.length, 1);
    const barWidth = Math.min(compact ? 10 : 13, slot * 0.27);
    const tooltip = document.createElement('div'); tooltip.className = 'points-tooltip'; tooltip.hidden = true;
    const viewport = document.createElement('div'); viewport.className = 'points-chart-scroll';
    for (const [index, bucket] of buckets.entries()) {
      const x = left + slot * (index + 0.5);
      const description = `${bucket.start}${bucket.start !== bucket.end ? ` 至 ${bucket.end}` : ''}：获取 ${global.LinuxSbPoints.format(bucket.income)}，消耗 ${global.LinuxSbPoints.format(bucket.expense)} 积分`;
      const group = svgNode('g', { class: 'points-bar-group', 'aria-label': description, ...(compact ? {} : { tabindex: '0', role: 'img' }) });
      group.append(svgNode('title', {}, description));
      group.append(svgNode('rect', { x: x - slot / 2 + 1, y: top - 4, width: Math.max(0, slot - 2), height: plotHeight + 4, rx: 5, fill: 'transparent', class: 'points-bar-hit' }));
      for (const [kind, offset] of [['income', -barWidth - 1.5], ['expense', 1.5]]) {
        const h = bucket[kind] / ceiling * plotHeight;
        group.append(svgNode('rect', { x: x + offset, y: top + plotHeight - h, width: barWidth, height: h, rx: Math.min(3, h / 2), fill: `url(#${id}-${kind})` }));
      }
      if (!compact) {
        const show = () => { tooltip.textContent = description; tooltip.hidden = false; };
        group.addEventListener('mouseenter', show); group.addEventListener('focus', show);
        group.addEventListener('mouseleave', () => { tooltip.hidden = true; });
        group.addEventListener('blur', () => { tooltip.hidden = true; });
      }
      svg.append(group);
      // Keep popup labels legible at 8 weeks and long desktop series.
      const stride = compact ? 1 : Math.max(1, Math.ceil(buckets.length / 24));
      if ((index % stride === 0 && buckets.length - 1 - index >= stride) || index === buckets.length - 1) {
        svg.append(svgNode('text', { x, y: height - 6, 'text-anchor': 'middle', class: 'points-axis' }, bucket.label));
      }
    }
    viewport.append(svg); container.append(viewport);
    if (!compact) container.append(tooltip);
    if (!compact && typeof ResizeObserver !== 'undefined') {
      let state = observed.get(container);
      if (!state) {
        state = { width: container.clientWidth, buckets, mode };
        state.observer = new ResizeObserver(() => {
          const nextWidth = container.clientWidth;
          if (nextWidth > 0 && Math.abs(nextWidth - state.width) > 1) {
            state.width = nextWidth; render(container, state.buckets, { mode: state.mode });
          }
        });
        observed.set(container, state); state.observer.observe(container);
      }
      state.width = container.clientWidth; state.buckets = buckets; state.mode = mode;
    }
  }
  global.LinuxSbPointsChart = { render };
})(globalThis);
