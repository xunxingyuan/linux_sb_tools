(function (global) {
  'use strict';
  const TIME_ZONE = 'Asia/Shanghai';
  const DAY = 86400000;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  const format = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`;
  function validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function dayKey(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text) && !validDay(text.slice(0, 10))) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDay(text) ? text : '';
      // Forum timestamps without an offset are Beijing time, not the device timezone.
      const local = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
      if (local) return validDay(local[1]) && !Number.isNaN(Date.parse(`${local[1]}T${local[2]}+08:00`)) ? local[1] : '';
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return '';
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function addDays(day, count) {
    return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
  }
  function weekStart(day) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return addDays(day, -((weekday + 6) % 7));
  }
  // Match the reason field, never a topic title or a loose keyword in a user/title name.
  // The main templates below were checked against the forum's actual points ledger.
  const SOURCE_RULES = [
    ['interaction-reversal', '奖励扣回', '互动奖励扣回', /^帖子(?:删除|移动至无奖励[版板]块)退回互动奖励$/, -1],
    ['post-reversal', '奖励扣回', '发帖奖励扣回', /^帖子(?:删除|移动至无奖励[版板]块)退回发帖奖励$/, -1],
    ['reply-reversal', '奖励扣回', '回帖奖励扣回', /^帖子(?:删除|移动至无奖励[版板]块)退回回帖奖励$/, -1],
    ['daily-post', '社区奖励', '每日首帖奖励', /^每日首个主帖奖励$/, 1],
    ['daily-reply', '社区奖励', '每日首回帖奖励', /^每日首个回帖奖励$/, 1],
    ['first-reply', '社区奖励', '抢沙发奖励', /^抢沙发奖励$/, 1],
    ['interaction', '社区奖励', '互动奖励', /^互动奖励$/, 1],
    ['post', '社区奖励', '发帖奖励', /^(?:发帖|发表主题)奖励$/, 1],
    ['reply', '社区奖励', '回帖奖励', /^(?:回帖|回复|评论)奖励$/, 1],
    ['featured', '社区奖励', '精华奖励', /^(?:帖子被评为精华|(?:帖子设为精华|精华帖|精华)奖励)$/, 1],
    ['like', '社区奖励', '点赞奖励', /^(?:收到点赞|点赞)奖励$/, 1],
    ['sidebar-ad', '广告奖励', '侧边栏广告奖励', /^每日首次显示侧边栏广告奖励$/, 1],
    ['daily-hidden-ad', '广告奖励', '每日隐藏广告奖励', /^每日首次隐藏侧边栏广告奖励$/, 1],
    ['first-hidden-ad', '广告奖励', '首次隐藏广告奖励', /^首次隐藏侧边栏广告奖励$/, 1],
    ['ad-draw', '广告奖励', '有奖广告抽奖', /^每日有奖广告抽奖$/, 1],
    ['ad-view', '广告奖励', '浏览广告奖励', /^浏览广告奖励$/, 1],
    ['checkin', '签到登录', '每日签到', /^每日签到$/, 1],
    ['login', '签到登录', '登录奖励', /^(?:每日)?登录奖励$/, 1],
    ['reply-packet', '红包', '回复红包领取', /^回复红包帖领取积分$/, 1],
    ['approved-packet', '红包', '讨论红包审核领取', /^审核认可回复[,，]领取红包积分$/, 1],
    ['approved-packet-rebate', '红包', '讨论红包认可返现', /^讨论红包认可返现$/, 1],
    ['packet-escrow', '红包', '红包积分托管', /^发布红包帖[,，]积分托管$/, -1],
    ['packet-claim', '红包', '普通红包领取', /^领取(?:随机|拼手气)?红包(?:积分)?$/, 1],
    ['packet-send', '红包', '发布红包', /^发布(?:随机|拼手气|讨论)?红包$/, -1],
    ['packet-refund', '红包', '红包退款', /^(?:红包(?:到期|撤回|取消)?(?:退回|退款)|退回红包剩余积分)$/, 1],
    ['tip-bonus', '打赏', '幸运打赏奖励', /^幸运打赏奖励$/, 1],
    ['tip-topic-in', '打赏', '收到主题打赏', /^用户「…」打赏了你的主题$/, 1],
    ['tip-reply-in', '打赏', '收到回复打赏', /^用户「…」打赏了你的回复$/, 1],
    ['tip-topic-out', '打赏', '送出主题打赏', /^给用户「…」的主题打赏$/, -1],
    ['tip-reply-out', '打赏', '送出回复打赏', /^给用户「…」的回复打赏$/, -1],
    ['tip-in', '打赏', '收到打赏', /^收到(?:打赏|赞赏)$/, 1],
    ['tip-out', '打赏', '送出打赏', /^打赏帖子$/, -1],
    ['reply-coin', '投币', '回帖投币收入', /^主题《…》中的回帖收到投币$/, 1],
    ['draw-free', '称号抽取', '免费称号抽取', /^(?:免费抽卡|免费单抽|免费一抽)[:：]称号系统$/, 0],
    ['draw-single', '称号抽取', '称号单抽', /^(?:抽卡|单抽)[:：]称号系统$/, -1],
    ['draw-ten', '称号抽取', '称号十连抽', /^十连抽[:：]称号系统$/, -1],
    ['draw-hundred', '称号抽取', '称号百连抽', /^百连抽[:：]称号系统$/, -1],
    ['recycle', '称号回收', match => `${match[1]} 称号回收`, /^(UR|SSR|SR|R|N)\s*回收[:：]称号系统$/, 1],
    ['recycle-general', '称号回收', '称号回收', /^(?:回收称号|称号回收)$/, 1],
    ['title-buy', '称号交易', '称号购买', /^购买称号(?:「…」(?:\s*[×x*]\s*\d+)?)?$/, -1],
    ['title-sell', '称号交易', '称号出售', /^出售称号(?:「…」(?:\s*[×x*]\s*\d+)?)?$/, 1],
    ['title-fee', '称号交易', '称号交易手续费', /^称号(?:交易|出售|发布交易)手续费$/, -1],
    ['title-refund', '称号交易', '称号交易退款', /^称号(?:购买|交易)退款$/, 1],
    ['virtual-card', '资源兑换', '虚拟卡兑换', /^兑换虚拟卡「…」$/, -1],
    ['community-search', '社区服务', '站内搜索费用', /^社区搜索\(全部内容\)$/, -1],
    ['edit-post', '社区服务', '编辑主帖扣费', /^编辑主帖$/, -1],
    ['old-reply-fee', '社区服务', '挖坟回复扣分', /^回复挖坟扣积分\(超过\d+天\)$/, -1],
    ['avatar-upload', '账号服务', '本地头像上传', /^上传本地头像$/, -1],
    ['identity-fee', '账号服务', '身份鉴定费用', /^身份鉴定费\([^()]+\)$/, -1],
    ['knife-kill', '小游戏', '飞刀大乱斗击杀奖励', /^飞刀大乱斗击杀奖励$/, 1],
    ['prediction-pool', '竞猜', '精华竞猜奖池结算', /^精华竞猜奖池结算奖励$/, 1],
    ['lottery-entry', '社区抽奖', '参与社区抽奖', /^参与抽奖(?:扣除积分)?$/, -1],
    ['lottery-win', '社区抽奖', '社区中奖奖励', /^(?:抽奖中奖|中奖)奖励$/, 1],
    ['invite', '邀请', '邀请奖励', /^(?:邀请注册|邀请用户|邀请)奖励$/, 1],
    ['node-create', '节点', '创建节点', /^创建节点(?:「…」)?$/, -1],
    ['node-reward', '节点', '节点奖励', /^节点奖励$/, 1],
    ['recharge', '充值兑换', '积分充值', /^(?:积分充值|充值积分)$/, 1],
    ['adjustment', '系统调整', '系统积分调整', /^(?:系统|管理员)(?:积分调整|调整积分)$/, null]
  ];
  function sourceTemplate(reason) {
    return String(reason || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      .replace(/「[^」]*」|“[^”]*”|『[^』]*』|"[^"\n]*"/g, '「…」').replace(/《[^》]*》/g, '《…》');
  }
  function classify(row) {
    const source = sourceTemplate(row.reason);
    for (const [key, group, label, pattern, expected] of SOURCE_RULES) {
      const match = source.match(pattern);
      if (!match) continue;
      const amount = row.change;
      const validAmount = typeof amount === 'number' && Number.isFinite(amount);
      const mismatch = validAmount && expected !== null && (expected === 0 ? amount !== 0 : amount === 0 || Math.sign(amount) !== expected);
      return { key: key === 'recycle' ? `${key}-${match[1]}` : key, group,
        label: typeof label === 'function' ? label(match) : label, source,
        status: !validAmount ? '金额待识别' : mismatch ? '方向待核对' : '已识别',
        needsReview: !validAmount || mismatch,
        evidence: `原始原因匹配“${source}”${expected === null ? '' : `；预期${expected === 0 ? '免费（零变动）' : expected > 0 ? '获取积分' : '消耗积分'}`}` };
    }
    return { key: 'unclassified', group: '待分类', label: '待分类', source: source || '未注明原因',
      status: '来源待识别', needsReview: true, evidence: '未匹配到明确来源规则，保留原始原因，不根据金额或关键词推测用途' };
  }
  function category(row) { return classify(row).label; }
  function counterparty(row, classification = classify(row)) {
    if (classification.needsReview || !/^tip-(?:topic|reply)-(?:in|out)$/.test(classification.key)) return null;
    // The ledger names a counterparty only for direct tips. A topic author,
    // packet publisher or lucky-tip bonus must not be inferred as the sender.
    const match = String(row.reason || '').match(/^(?:用户|给用户)(?:「([^」]+)」|“([^”]+)”|『([^』]+)』|"([^"\n]+)")/);
    const name = match && match.slice(1).find(Boolean)?.trim();
    return name ? { name, direction: classification.key.endsWith('-in') ? 'income' : 'expense' } : null;
  }
  function relatedTopic(row) {
    try {
      const url = new URL(row.relatedUrl);
      const match = url.pathname.match(/^\/topic\/(\d+)$/);
      if (url.origin !== 'https://linux.sb' || !match) return null;
      return { id: match[1], url: `https://linux.sb/topic/${match[1]}`, title: row.relatedTitle || `主题 #${match[1]}` };
    } catch (_) { return null; }
  }
  function records(rows) {
    return (rows || []).map(row => {
      const classification = classify(row);
      return { ...row, day: dayKey(row.time), category: classification.label, categoryGroup: classification.group, classification,
        counterparty: counterparty(row, classification), topic: relatedTopic(row),
        amount: typeof row.change === 'number' && Number.isFinite(row.change) ? row.change : null };
    });
  }
  function summary(rows) {
    let income = 0, expense = 0, invalid = 0, undated = 0;
    for (const row of rows) {
      if (row.amount === null) { invalid++; continue; }
      if (!row.day) undated++;
      income += Math.max(0, row.amount);
      expense += Math.max(0, -row.amount);
    }
    return { income, expense, net: income - expense, count: rows.length, invalid, undated };
  }
  function inRange(rows, start, end) {
    return rows.filter(row => row.day && (!start || row.day >= start) && (!end || row.day <= end));
  }
  function buckets(rows, { start, end, mode = 'day' }) {
    if (!validDay(start) || !validDay(end) || start > end) return [];
    const weekly = mode === 'week';
    const result = [], byDay = new Map();
    for (let day = weekly ? weekStart(start) : start; day <= end; day = addDays(day, weekly ? 7 : 1)) {
      const last = weekly ? addDays(day, 6) : day;
      const item = { key: day, start: day < start ? start : day, end: last > end ? end : last,
        label: `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`, income: 0, expense: 0, count: 0 };
      result.push(item); byDay.set(day, item);
    }
    for (const row of inRange(rows, start, end)) {
      if (row.amount === null) continue;
      const item = byDay.get(weekly ? weekStart(row.day) : row.day);
      item.income += Math.max(0, row.amount); item.expense += Math.max(0, -row.amount); item.count++;
    }
    return result;
  }
  function groups(rows) {
    const grouped = new Map();
    for (const row of rows) {
      const group = grouped.get(row.category) || { name: row.category, income: 0, expense: 0, count: 0 };
      group.count++;
      if (row.amount !== null) { group.income += Math.max(0, row.amount); group.expense += Math.max(0, -row.amount); }
      grouped.set(row.category, group);
    }
    return [...grouped.values()].sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
  }
  function people(rows, direction) {
    const leaders = new Map();
    let unattributedCount = 0, unattributedAmount = 0, amount = 0, count = 0;
    for (const row of rows) {
      if (row.amount === null || (direction === 'income' ? row.amount <= 0 : row.amount >= 0)) continue;
      if (!row.classification.key.startsWith('tip-') || row.classification.key === 'tip-bonus') continue;
      const points = Math.abs(row.amount), person = row.counterparty;
      if (!person || person.direction !== direction) { unattributedCount++; unattributedAmount += points; continue; }
      const entry = leaders.get(person.name) || { name: person.name, amount: 0, count: 0 };
      entry.amount += points; entry.count++; leaders.set(person.name, entry); amount += points; count++;
    }
    return { leaders: [...leaders.values()].sort((a, b) => b.amount - a.amount || b.count - a.count || a.name.localeCompare(b.name)),
      count, amount, unattributedCount, unattributedAmount };
  }
  function isTopicIncome(row) {
    return row.amount !== null && row.amount > 0 && Boolean(row.topic) && row.classification.key !== 'tip-bonus';
  }
  function topics(rows) {
    const grouped = new Map();
    for (const row of rows) {
      if (!isTopicIncome(row)) continue;
      const entry = grouped.get(row.topic.id) || { ...row.topic, amount: 0, count: 0 };
      entry.amount += row.amount; entry.count++; grouped.set(entry.id, entry);
    }
    return [...grouped.values()].sort((a, b) => b.amount - a.amount || b.count - a.count || a.id.localeCompare(b.id));
  }
  function composition(rows, direction) {
    const grouped = new Map();
    for (const row of rows) {
      if (row.amount === null) continue;
      const amount = direction === 'income' ? Math.max(0, row.amount) : Math.max(0, -row.amount);
      if (!amount) continue;
      grouped.set(row.categoryGroup, (grouped.get(row.categoryGroup) || 0) + amount);
    }
    const all = [...grouped].map(([name, amount]) => ({ name, amount, groups: [name] })).sort((a, b) => b.amount - a.amount);
    const total = all.reduce((sum, item) => sum + item.amount, 0);
    const segments = all.slice(0, 5);
    if (all.length > 5) segments.push({ name: '其他来源', amount: all.slice(5).reduce((sum, item) => sum + item.amount, 0), groups: all.slice(5).map(item => item.name) });
    return { total, segments };
  }
  function activity(rows, { start, end }) {
    if (!validDay(start) || !validDay(end) || start > end) return { days: [], activeDays: 0, dayCount: 0, averageNet: 0, bestDay: null };
    const days = new Map();
    for (const row of inRange(rows, start, end)) {
      const day = days.get(row.day) || { day: row.day, count: 0, income: 0, expense: 0 };
      day.count++;
      if (row.amount !== null) { day.income += Math.max(0, row.amount); day.expense += Math.max(0, -row.amount); }
      days.set(row.day, day);
    }
    const dayCount = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
    const net = [...days.values()].reduce((sum, day) => sum + day.income - day.expense, 0);
    const bestDay = [...days.values()].filter(day => day.income > 0).sort((a, b) => b.income - a.income || b.day.localeCompare(a.day))[0] || null;
    return { days: [...days.values()], activeDays: days.size, dayCount, averageNet: net / dayCount, bestDay };
  }
  function recentRange(mode, now = new Date()) {
    const end = dayKey(now);
    return { start: mode === 'week' ? addDays(weekStart(end), -49) : addDays(end, -6), end };
  }
  const api = { TIME_ZONE, format, signed, validDay, dayKey, addDays, weekStart, category, classify, sourceTemplate, counterparty, relatedTopic, people, isTopicIncome, topics, composition, activity, records, summary, inRange, buckets, groups, recentRange };
  global.LinuxSbPoints = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
