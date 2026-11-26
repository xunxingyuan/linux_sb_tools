(function (global) {
  'use strict';
  async function collect({ snapshot, fetchPage, rebuild = false, onProgress }) {
    const parser = global.LinuxSbTitleStats;
    const store = global.LinuxSbState;
    const previous = snapshot.sync.pointsRows || {};
    const result = await global.LinuxSbHistory.collectPages({
      firstUrl: `https://linux.sb/user/${snapshot.userId}?tab=points_rewards&p=1`,
      fetchPage: async url => {
        const doc = await fetchPage(url);
        if (parser.findUserId(doc) !== snapshot.userId) throw new Error('登录状态或账号已变化，旧积分流水已保留');
        if (!doc.querySelector('.points-rewards-detail') && !/暂无|没有.*(?:记录|流水)|尚无|空空如也/.test(parser.textOf(doc.querySelector('main')))) {
          throw new Error('未识别到积分流水列表，旧数据已保留');
        }
        return doc;
      },
      parsePage: parser.parseAllPointsHistoryPage,
      pageUrls: (doc, url) => parser.parsePaginationUrls(doc, url, 'points_rewards'),
      known: snapshot.pointsRows, incremental: !rebuild && previous.complete === true,
      key: store.recordKey, onProgress
    });
    const rows = store.mergeRecords([], result.rows);
    const meta = { updatedAt: new Date().toISOString(), pages: result.pages, mode: result.mode,
      complete: result.reachedEnd || previous.complete === true,
      firstTime: rows[0]?.time || '', lastTime: rows.at(-1)?.time || '', error: '' };
    return {
      pointsRows: rows, historyRows: rows.filter(row => parser.isTitleHistoryReason(row.reason)),
      sync: { pointsRows: meta, historyRows: { ...meta } }
    };
  }
  global.LinuxSbPointsSync = { collect };
})(globalThis);
