(function () {
  'use strict';
  const api = globalThis.LinuxSbState;
  let queue = Promise.resolve();
  async function dispatch(message, sender) {
    const stored = await chrome.storage.local.get(api.STORAGE_KEY);
    const root = api.normalize(stored[api.STORAGE_KEY]);
    const { action, userId } = message;
    let result;
    const needsAccount = !['GET', 'SETTINGS'].includes(action);
    if (needsAccount && !/^\d+$/.test(userId || '')) throw new Error('未确认当前账号，请先打开称号页面');
    const account = needsAccount ? (root.accounts[userId] ||= api.emptyAccount()) : null;
    switch (action) {
      case 'GET': result = api.snapshot(root, userId); break;
      case 'SETTINGS': {
        for (const key of Object.keys(api.DEFAULT_SETTINGS)) {
          if (Object.hasOwn(message.patch || {}, key)) root.settings[key] = message.patch[key];
        }
        result = api.snapshot(root, userId);
        break;
      }
      case 'CURRENT':
        account.current = { ...account.current, ...message.current };
        account.updatedAt = new Date().toISOString();
        root.activeUserId = userId;
        result = api.snapshot(root, userId);
        break;
      case 'HISTORY':
        if (message.generation !== account.historyGeneration) throw new Error('统计已被清除，本次旧同步结果未保存，请重新更新');
        for (const key of ['historyRows', 'forgeEvents']) {
          if (Array.isArray(message[key])) account[key] = message.rebuild ? message[key] : api.mergeRecords(account[key], message[key]);
        }
        account.sync = { ...account.sync, ...message.sync };
        result = api.snapshot(root, userId);
        break;
      case 'CLEAR_HISTORY':
        account.historyRows = [];
        account.forgeEvents = [];
        account.sync = {};
        account.historyGeneration += 1;
        result = api.snapshot(root, userId);
        break;
      case 'FORGE_GET': result = account.pendingForge ? { ...account.pendingForge, ownedByTab: account.pendingForge.tabId === sender.tab?.id } : null; break;
      case 'FORGE_START': {
        if (!Number.isInteger(sender.tab?.id)) throw new Error('请在熔铸页面发起任务');
        if (account.pendingForge && Date.now() - account.pendingForge.startedAt < 900000) throw new Error('已有熔铸任务，请先停止原任务');
        account.pendingForge = {
          id: crypto.randomUUID(), userId, tabId: sender.tab.id,
          startedAt: Date.now(), stageIndex: 0, phase: 'ready',
          targetRarity: message.targetRarity === 'SSR' ? 'SSR' : 'SR',
          excludedNames: message.excludedNames || [], keepOne: message.keepOne !== false
        };
        result = account.pendingForge;
        break;
      }
      case 'FORGE_STOP':
        if (message.id && account.pendingForge?.id !== message.id) throw new Error('任务已变化，请刷新页面');
        account.pendingForge = null;
        result = null;
        break;
      case 'FORGE_STEP': {
        const task = account.pendingForge;
        if (!task || task.id !== message.id || task.tabId !== sender.tab?.id) throw new Error('任务已停止或属于其他标签页');
        if (Date.now() - task.startedAt > 900000) throw new Error('熔铸任务已超时，请停止后重新发起');
        if (task.phase === 'awaiting') {
          if (task.documentToken === message.documentToken) throw new Error('正在等待站点完成当前阶段');
          if (!globalThis.LinuxSbForge.verifyStage(task.proof, message.inventory)) throw new Error('未能确认上一阶段成功，任务已暂停；请核对库存后停止任务');
          task.stageIndex += 1;
          task.phase = 'ready';
          delete task.proof;
        } else if (message.skip) {
          if (message.stageIndex !== task.stageIndex) throw new Error('阶段已变化');
          task.stageIndex += 1;
        } else {
          if (message.proof?.stageIndex !== task.stageIndex) throw new Error('阶段已变化');
          task.phase = 'awaiting';
          task.proof = message.proof;
          task.documentToken = message.documentToken;
        }
        result = task;
        break;
      }
      default: throw new Error('未知操作');
    }
    if (!['GET', 'FORGE_GET'].includes(action) || stored[api.STORAGE_KEY]?.version !== 2) {
      await chrome.storage.local.set({ [api.STORAGE_KEY]: root });
      // Legacy tasks lack account/tab ownership and must never auto-resume.
      if (stored[api.STORAGE_KEY]?.version !== 2) await chrome.storage.local.remove('pendingForgeChain');
    }
    return result;
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'STATE') return undefined;
    const next = queue.then(() => dispatch(message, sender));
    queue = next.catch(() => {});
    next.then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
