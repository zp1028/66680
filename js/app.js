// 彩票数据分析移动端应用 v5.0 - 主逻辑

// 全局状态
const AppState = {
  currentConfig: null,
  adapter: null,
  historyRows: [],
  sequences: {},
  sumSequence: [], // v4 新增：和值序列
  latest: null,
  liveData: null,
  autoRefresh: true,
  refreshTimer: null,
  countdownTimer: null,
  lastSettledIssue: null,
  nRecent: 100,
  ftDays: 7,
  darkMode: false,
  positionPredictions: {},
  comboPrediction: null,
  ewmaMgr: null, // v4 新增：EWMA 管理器
  ewmaScores: {}, // v4 新增：当前彩种各分类的 EWMA 评分
  backfilling: false, // v4 新增：是否正在回填
  backfillAbort: false, // v4 新增：是否中止回填
  // v5.0 新增
  currentAlgo: 'experience', // 当前选中的算法: experience/pattern/manual/compare
  algoPredictions: {}, // 各算法的预测结果缓存 { dx: {experience: {...}, pattern: {...}, manual: {...}}, ds: {...} }
  lastStatsStreak: 0, // 最近连错期数（用于谨慎预测）
  // v5.3 新增
  currentComboAlgo: 'experience', // 组合预测当前算法
  currentPosAlgo: 'experience',   // 位置预测当前算法
};

// ==================== 初始化 ====================

function init() {
  // v4 新增：先加载用户偏好到 Settings
  UserPrefs.applyToSettings();

  // v4 新增：初始化 EWMA 管理器
  AppState.ewmaMgr = new EWMAManager(CacheDB);
  AppState.ewmaMgr.setAlpha(Settings.ewmaAlpha);

  initLotterySelect();
  initNavigation();
  initSubTabs();
  initControls();
  initTheme();
  // v5.0 新增
  initAlgoSelector();
  initStatsPage();
  // v5.1 新增
  initManualMarks();
  loadSavedSettings();

  // 默认选中第一个彩种
  const firstLottery = LOTTERY_CATALOG[0];
  if (firstLottery) {
    selectLottery(firstLottery.code);
  }
}

function initTheme() {
  try {
    const saved = localStorage.getItem('lottery_dark_mode');
    if (saved === '1') {
      enableDarkMode(true);
    }
  } catch (e) {}

  document.getElementById('themeBtn').addEventListener('click', toggleDarkMode);
  document.getElementById('darkModeSwitch').addEventListener('change', (e) => {
    enableDarkMode(e.target.checked);
  });
}

function toggleDarkMode() {
  enableDarkMode(!AppState.darkMode);
}

function enableDarkMode(enabled) {
  AppState.darkMode = enabled;
  if (enabled) {
    document.body.classList.add('dark-mode');
    document.getElementById('themeBtn').textContent = '☀️';
  } else {
    document.body.classList.remove('dark-mode');
    document.getElementById('themeBtn').textContent = '🌙';
  }
  document.getElementById('darkModeSwitch').checked = enabled;
  try {
    localStorage.setItem('lottery_dark_mode', enabled ? '1' : '0');
  } catch (e) {}
}

function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('lottery_app_settings');
    if (saved) {
      const s = JSON.parse(saved);
      AppState.autoRefresh = s.autoRefresh !== false;
      AppState.ftDays = s.ftDays || 7;
      AppState.nRecent = s.nRecent || 100;

      document.getElementById('autoRefresh').checked = AppState.autoRefresh;
      document.getElementById('ftDays').value = AppState.ftDays;
      document.getElementById('ftDaysVal').textContent = AppState.ftDays;
      document.getElementById('nRecent').value = AppState.nRecent;
      document.getElementById('nRecentVal').textContent = AppState.nRecent;
    }

    // v4 新增：加载用户偏好设置（预测窗口、位置数量等）
    const prefs = UserPrefs.load();
    const predWinEl = document.getElementById('predWindow');
    if (predWinEl) {
      predWinEl.value = prefs.predictionWindow || 100;
      document.getElementById('predWindowVal').textContent = prefs.predictionWindow || 100;
    }
    const posNEl = document.getElementById('positionTopN');
    if (posNEl) {
      posNEl.value = prefs.positionTopN || 3;
      document.getElementById('positionTopNVal').textContent = prefs.positionTopN || 3;
    }
    const ewmaEl = document.getElementById('ewmaEnabled');
    if (ewmaEl) ewmaEl.checked = prefs.ewmaEnabled !== false;
    const crossEl = document.getElementById('zuheCrossEnabled');
    if (crossEl) crossEl.checked = prefs.zuheCrossFeature !== false;
    const trendEl = document.getElementById('trendBoostEnabled');
    if (trendEl) trendEl.checked = prefs.trendBoostEnabled !== false;
    // v4.2 新增：灵敏度模式
    const sensMode = prefs.sensitivityMode || 'balanced';
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === sensMode);
    });
    // v4.2 新增：动量强度
    const momEl = document.getElementById('momentumStrength');
    if (momEl) {
      momEl.value = prefs.momentumStrength !== undefined ? prefs.momentumStrength : 0.5;
      document.getElementById('momentumStrengthVal').textContent =
        (prefs.momentumStrength !== undefined ? prefs.momentumStrength : 0.5).toFixed(1);
    }
    // v4.2 新增：反同质化强度
    const antiHerdEl = document.getElementById('antiHerdStrength');
    if (antiHerdEl) {
      antiHerdEl.value = prefs.antiHerdStrength !== undefined ? prefs.antiHerdStrength : 0.3;
      document.getElementById('antiHerdStrengthVal').textContent =
        (prefs.antiHerdStrength !== undefined ? prefs.antiHerdStrength : 0.3).toFixed(1);
    }
    // v4.2 新增：连续相同衰减
    const streakEl = document.getElementById('streakDecayEnabled');
    if (streakEl) streakEl.checked = prefs.streakDecayEnabled !== false;
    const ewmaAlphaEl = document.getElementById('ewmaAlpha');
    if (ewmaAlphaEl) {
      ewmaAlphaEl.value = prefs.ewmaAlpha || 0.25;
      document.getElementById('ewmaAlphaVal').textContent = (prefs.ewmaAlpha || 0.25).toFixed(2);
    }
    const ewmaTempEl = document.getElementById('ewmaTemp');
    if (ewmaTempEl) {
      ewmaTempEl.value = prefs.ewmaWeightTemperature || 0.08;
      document.getElementById('ewmaTempVal').textContent = (prefs.ewmaWeightTemperature || 0.08).toFixed(2);
    }

  } catch (e) {}
}

function saveSettings() {
  try {
    localStorage.setItem('lottery_app_settings', JSON.stringify({
      autoRefresh: AppState.autoRefresh,
      ftDays: AppState.ftDays,
      nRecent: AppState.nRecent,
    }));
  } catch (e) {}
}

// ==================== 彩种选择 ====================

function initLotterySelect() {
  const select = document.getElementById('lotterySelect');
  select.innerHTML = '<option value="">选择彩种</option>';
  for (const item of LOTTERY_CATALOG) {
    const opt = document.createElement('option');
    opt.value = item.code;
    opt.textContent = item.name;
    select.appendChild(opt);
  }
  select.addEventListener('change', (e) => {
    if (e.target.value) {
      selectLottery(parseInt(e.target.value));
    }
  });

  // 彩种列表（设置页）
  const list = document.getElementById('lotteryList');
  list.innerHTML = '';
  for (const item of LOTTERY_CATALOG) {
    const div = document.createElement('div');
    div.className = 'lottery-list-item';
    div.innerHTML = '<span>' + item.name + '</span><span class="code">' + item.code + ' / ' + item.type + '</span>';
    list.appendChild(div);
  }
}

function selectLottery(code) {
  const item = LOTTERY_CATALOG.find(x => x.code === code);
  if (!item) return;

  document.getElementById('lotterySelect').value = code;
  AppState.currentConfig = item;
  AppState.adapter = createAdapter(item);
  AppState.historyRows = [];
  AppState.lastSettledIssue = null;
  AppState.positionPredictions = {};
  AppState.comboPrediction = null;
  AppState.ewmaScores = {};

  // 显示骨架屏
  showSkeleton();
  document.getElementById('pageHome').style.display = 'none';
  document.getElementById('errorContainer').style.display = 'none';

  // v4 更新：组合预测现在 PK10 和 Luck20 都支持
  const hasCombo = true;
  document.getElementById('luzhuComboLabel').style.display = hasCombo ? '' : 'none';
  document.getElementById('pieComboCard').style.display = hasCombo ? '' : 'none';
  document.getElementById('labComboTab').style.display = hasCombo ? '' : 'none';

  // v4 新增：加载 EWMA 评分
  loadEwmaScores();

  // v5.1 新增：加载手动标记数据
  loadManualMarks();

  // 加载数据
  loadData();
}

// v5.1 新增：加载当前彩种的手动标记数据
async function loadManualMarks() {
  if (!AppState.currentConfig) return;
  try {
    const manualPred = PredictorFactory.get('manual');
    await manualPred.loadMarks(AppState.currentConfig.code, '大小');
    await manualPred.loadMarks(AppState.currentConfig.code, '单双');
  } catch (e) {
    console.warn('加载手动标记失败:', e);
  }
}

// v4 新增：加载当前彩种的 EWMA 评分
async function loadEwmaScores() {
  if (!AppState.ewmaMgr || !AppState.currentConfig) return;
  try {
    await AppState.ewmaMgr.loadAll(AppState.currentConfig.code);
  } catch (e) {
    console.warn('Load EWMA scores failed:', e);
  }
}

// ==================== 骨架屏 ====================

function showSkeleton() {
  document.getElementById('skeletonContainer').style.display = 'block';
  document.getElementById('loadingContainer').style.display = 'none';
}

function hideSkeleton() {
  document.getElementById('skeletonContainer').style.display = 'none';
}

function showError(message) {
  hideSkeleton();
  document.getElementById('loadingContainer').style.display = 'none';
  document.getElementById('pageHome').style.display = 'none';
  const errBox = document.getElementById('errorContainer');
  document.getElementById('errorMessage').textContent = message || '请检查网络连接';
  errBox.style.display = 'block';
}

// ==================== 导航 ====================

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      switchPage(page);
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const target = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
  if (target) target.style.display = 'block';

  if (page === 'analysis') {
    updateAnalysisPage();
  } else if (page === 'lab') {
    updateLabPage();
  } else if (page === 'stats') {
    updateStatsPage();
  } else if (page === 'history') {
    updateHistoryPage();
  } else if (page === 'settings') {
    updateDbStats();
  }
}

// ==================== 子标签 ====================

function initSubTabs() {
  const tabs = document.querySelectorAll('.sub-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.sub-page').forEach(p => p.style.display = 'none');
      const target = document.getElementById('sub' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
      if (target) target.style.display = 'block';

      updateSubTab(tabName);
    });
  });

  // 实验室标签
  const labTabs = document.querySelectorAll('.lab-tab');
  labTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      labTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      runLabEvaluation(tab.dataset.cat);
    });
  });
}

function updateSubTab(tabName) {
  if (tabName === 'freq') renderFreqChart();
  else if (tabName === 'sum') renderSumChart();
  else if (tabName === 'bs') renderBsPies();
  else if (tabName === 'period') updatePeriodAnalysis();
  else if (tabName === 'luzhu') renderLuzhu();
}

// ==================== 控件初始化 ====================

function initControls() {
  document.getElementById('freqN').addEventListener('input', (e) => {
    document.getElementById('freqNVal').textContent = e.target.value;
    renderFreqChart();
  });

  document.getElementById('sumN').addEventListener('input', (e) => {
    document.getElementById('sumNVal').textContent = e.target.value;
    renderSumChart();
  });

  document.getElementById('luzhuN').addEventListener('input', (e) => {
    document.getElementById('luzhuNVal').textContent = e.target.value;
    renderLuzhu();
  });

  document.querySelectorAll('input[name="luzhuMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      renderLuzhu();
    });
  });

  document.getElementById('patLen').addEventListener('input', (e) => {
    document.getElementById('patLenVal').textContent = e.target.value;
    updatePatternTail();
  });

  document.getElementById('patQueryBtn').addEventListener('click', queryPattern);

  document.getElementById('minHist').addEventListener('input', (e) => {
    document.getElementById('minHistVal').textContent = e.target.value;
    const activeTab = document.querySelector('.lab-tab.active');
    if (activeTab) runLabEvaluation(activeTab.dataset.cat);
  });

  ['filterCat', 'filterResult', 'filterWindow'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateHistoryPage);
  });

  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('确定清空本彩种的所有预测记录吗？')) {
      if (AppState.adapter) {
        Storage.clearPredictions(AppState.adapter.predKey);
        updateHistoryPage();
        updateStreakCard();
      }
    }
  });

  // 清空本彩种历史数据库
  document.getElementById('clearDbBtn').addEventListener('click', async () => {
    if (confirm('确定清空本彩种的所有离线历史数据吗？\n（预测记录不会被删除）')) {
      if (AppState.adapter) {
        try {
          await CacheDB.clearDrawHistory(AppState.currentConfig.code);
          await updateDbStats();
          alert('已清空本彩种历史数据库');
        } catch (e) {
          alert('清空失败：' + e.message);
        }
      }
    }
  });

  // 清空所有数据库
  document.getElementById('clearAllDbBtn').addEventListener('click', async () => {
    if (confirm('确定清空所有彩种的历史数据库和预测记录吗？\n此操作不可恢复！')) {
      try {
        // 清空所有彩种的开奖历史
        for (const lot of LOTTERY_CATALOG) {
          await CacheDB.clearDrawHistory(lot.code);
          await CacheDB.clearPredStats(lot.code);
          // 同时清空 localStorage 预测记录
          try {
            const predKey = (lot.type === 'pks' ? 'pks_' : 'l20_') + lot.code;
            Storage.clearPredictions(predKey);
          } catch (e) {}
        }
        await updateDbStats();
        alert('已清空所有数据库');
        // 重新加载当前彩种
        if (AppState.currentConfig) {
          selectLottery(AppState.currentConfig.code);
        }
      } catch (e) {
        alert('清空失败：' + e.message);
      }
    }
  });

  document.getElementById('autoRefresh').addEventListener('change', (e) => {
    AppState.autoRefresh = e.target.checked;
    saveSettings();
    setupAutoRefresh();
  });

  document.getElementById('ftDays').addEventListener('input', (e) => {
    document.getElementById('ftDaysVal').textContent = e.target.value;
    AppState.ftDays = parseInt(e.target.value);
    saveSettings();
  });

  document.getElementById('nRecent').addEventListener('input', (e) => {
    document.getElementById('nRecentVal').textContent = e.target.value;
    AppState.nRecent = parseInt(e.target.value);
    saveSettings();
  });

  // v4 新增：预测窗口设置
  const predWinEl = document.getElementById('predWindow');
  if (predWinEl) {
    predWinEl.addEventListener('input', (e) => {
      document.getElementById('predWindowVal').textContent = e.target.value;
      UserPrefs.update('predictionWindow', parseInt(e.target.value));
      generatePredictions();
    });
  }

  // v4 新增：位置预测数量
  const posNEl = document.getElementById('positionTopN');
  if (posNEl) {
    posNEl.addEventListener('input', (e) => {
      document.getElementById('positionTopNVal').textContent = e.target.value;
      UserPrefs.update('positionTopN', parseInt(e.target.value));
      generatePredictions();
    });
  }

  // v4 新增：EWMA 开关
  const ewmaEl = document.getElementById('ewmaEnabled');
  if (ewmaEl) {
    ewmaEl.addEventListener('change', (e) => {
      UserPrefs.update('ewmaEnabled', e.target.checked);
      generatePredictions();
    });
  }

  // v4 新增：组合交叉特征开关
  const crossEl = document.getElementById('zuheCrossEnabled');
  if (crossEl) {
    crossEl.addEventListener('change', (e) => {
      UserPrefs.update('zuheCrossFeature', e.target.checked);
      generatePredictions();
    });
  }

  // v4 新增：冷热趋势增强开关
  const trendEl = document.getElementById('trendBoostEnabled');
  if (trendEl) {
    trendEl.addEventListener('change', (e) => {
      UserPrefs.update('trendBoostEnabled', e.target.checked);
      generatePredictions();
    });
  }

  // v4.2 新增：灵敏度模式切换
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      modeBtns.forEach(b => b.classList.toggle('active', b === btn));
      UserPrefs.update('sensitivityMode', mode);
      generatePredictions();
    });
  });

  // v4.2 新增：动量强度
  const momEl = document.getElementById('momentumStrength');
  if (momEl) {
    momEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('momentumStrengthVal').textContent = val.toFixed(1);
      UserPrefs.update('momentumStrength', val);
      generatePredictions();
    });
  }

  // v4.2 新增：反同质化强度
  const antiHerdEl = document.getElementById('antiHerdStrength');
  if (antiHerdEl) {
    antiHerdEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('antiHerdStrengthVal').textContent = val.toFixed(1);
      UserPrefs.update('antiHerdStrength', val);
      generatePredictions();
    });
  }

  // v4.2 新增：连续相同衰减开关
  const streakEl = document.getElementById('streakDecayEnabled');
  if (streakEl) {
    streakEl.addEventListener('change', (e) => {
      UserPrefs.update('streakDecayEnabled', e.target.checked);
      generatePredictions();
    });
  }

  // v4 新增：EWMA 灵敏度
  const ewmaAlphaEl = document.getElementById('ewmaAlpha');
  if (ewmaAlphaEl) {
    ewmaAlphaEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('ewmaAlphaVal').textContent = val.toFixed(2);
      UserPrefs.update('ewmaAlpha', val);
      // EWMA alpha 变化时更新管理器
      if (AppState.ewmaMgr) AppState.ewmaMgr.alpha = val;
      generatePredictions();
    });
  }

  // v4 新增：EWMA 权重锐度
  const ewmaTempEl = document.getElementById('ewmaTemp');
  if (ewmaTempEl) {
    ewmaTempEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('ewmaTempVal').textContent = val.toFixed(2);
      UserPrefs.update('ewmaWeightTemperature', val);
      generatePredictions();
    });
  }

  // v4 新增：批量回填按钮
  const backfillBtn = document.getElementById('backfillBtn');
  if (backfillBtn) {
    backfillBtn.addEventListener('click', startBackfill);
  }
}

// ==================== 数据加载（持久化数据库 + API增量更新） ====================

async function loadData() {
  if (!AppState.adapter) return;

  try {
    const lotCode = AppState.currentConfig.code;
    const days = AppState.ftDays;
    const today = new Date();
    let rows = [];

    // 第一步：从持久化数据库读取所有历史（永久保存，越用越多）
    try {
      const dbRows = await CacheDB.getDrawHistory(lotCode);
      if (dbRows && dbRows.length > 0) {
        rows = dbRows;
        AppState.historyRows = rows;
        AppState.sequences = AppState.adapter.extractSequences(rows);
        // v4 新增：提取和值序列
        if (AppState.adapter.extractSumSequence) {
          AppState.sumSequence = AppState.adapter.extractSumSequence(rows);
        }

        const latest = rows[rows.length - 1];
        AppState.latest = latest;

        document.getElementById('statTotal').textContent = rows.length.toLocaleString() + ' 💾';
        document.getElementById('statLatest').textContent = latest['期号'];
        document.getElementById('statTime').textContent = String(latest['开奖时间']).slice(5, 16);

        hideSkeleton();
        document.getElementById('pageHome').style.display = 'block';
        generatePredictions();
      }
    } catch (e) {
      console.warn('Read draw history DB failed:', e);
    }

    // 第二步：从 API 拉取最新数据，增量合并到数据库
    const freshRows = await AppState.adapter.fetchHistory(days);

    if (freshRows.length === 0 && rows.length === 0) {
      showError('数据加载失败，请检查网络或稍后重试');
      return;
    }

    if (freshRows.length > 0) {
      // 保存到持久化数据库（去重合并）
      try {
        const saved = await CacheDB.saveDrawHistory(lotCode, freshRows);
        console.log('Saved to draw history DB:', saved, 'records');
      } catch (e) {
        console.warn('Save draw history DB failed:', e);
      }

      // 同时保存到短期缓存（用于快速加载）
      for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const dayRows = freshRows.filter(r => String(r['开奖时间']).startsWith(dateStr));
        if (dayRows.length > 0) {
          try {
            await CacheDB.setHistory(lotCode, dateStr, dayRows, 2 * 3600 * 1000);
          } catch (e) {}
        }
      }

      // 重新从数据库读取完整数据（包含旧数据+新数据）
      try {
        const allRows = await CacheDB.getDrawHistory(lotCode);
        if (allRows && allRows.length > rows.length) {
          rows = allRows;
        } else {
          // 如果数据库读取失败，至少用API的新数据
          rows = freshRows;
        }
      } catch (e) {
        rows = freshRows;
      }

      AppState.historyRows = rows;
      AppState.sequences = AppState.adapter.extractSequences(rows);
      // v4 新增：提取和值序列
      if (AppState.adapter.extractSumSequence) {
        AppState.sumSequence = AppState.adapter.extractSumSequence(rows);
      }

      const latest = rows[rows.length - 1];
      AppState.latest = latest;

      document.getElementById('statTotal').textContent = rows.length.toLocaleString() + ' 💾';
      document.getElementById('statLatest').textContent = latest['期号'];
      document.getElementById('statTime').textContent = String(latest['开奖时间']).slice(5, 16);

      hideSkeleton();
      document.getElementById('errorContainer').style.display = 'none';
      document.getElementById('pageHome').style.display = 'block';

      // 加载实时数据
      await loadLiveData();

      // 生成预测
      generatePredictions();

      // 设置自动刷新
      setupAutoRefresh();

      // 更新连对连错
      updateStreakCard();

      // 更新数据库统计
      updateDbStats();
    }

  } catch (e) {
    console.error('Load data error:', e);
    if (AppState.historyRows.length === 0) {
      showError('数据加载失败：' + e.message);
    }
  }
}

// 更新数据库统计显示
async function updateDbStats() {
  try {
    const lotCode = AppState.currentConfig.code;
    const count = await CacheDB.getDrawHistoryCount(lotCode);
    const dbStatsEl = document.getElementById('dbRecordCount');
    if (dbStatsEl) {
      dbStatsEl.textContent = count.toLocaleString() + ' 期';
    }
  } catch (e) {}
}

// ==================== 实时数据 ====================

async function loadLiveData() {
  if (!AppState.adapter) return;

  try {
    const lotCode = AppState.currentConfig.code;

    // 先试缓存
    try {
      const cached = await CacheDB.getLatest(lotCode);
      if (cached) {
        AppState.liveData = cached;
        renderLiveBoard(cached);
        renderCountdown(cached);
        settlePredictions(cached);
      }
    } catch (e) {}

    // 再拉最新
    const rt = await AppState.adapter.fetchLatest();
    if (rt) {
      AppState.liveData = rt;
      renderLiveBoard(rt);
      renderCountdown(rt);
      settlePredictions(rt);

      // 缓存
      try {
        await CacheDB.setLatest(lotCode, rt, 10000); // 10秒TTL
      } catch (e) {}
    }
  } catch (e) {
    console.error('Live data error:', e);
  }
}

function renderLiveBoard(rt) {
  const board = document.getElementById('liveBoard');
  board.innerHTML = AppState.adapter.renderLive(rt);
}

function renderCountdown(rt) {
  const box = document.getElementById('countdownBox');
  const serverTime = parseApiTime(rt['服务器时间']);
  const drawTime = parseApiTime(rt['下期时间']);
  const nextIssue = rt['下期期号'] || '';

  if (!drawTime) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  document.getElementById('nextIssue').textContent = nextIssue;

  const now = serverTime || new Date();
  updateCountdown(drawTime, now);

  if (AppState.countdownTimer) clearInterval(AppState.countdownTimer);
  AppState.countdownTimer = setInterval(() => {
    updateCountdown(drawTime, null);
  }, 1000);
}

function updateCountdown(drawTime, baseTime) {
  const now = baseTime ? new Date(baseTime.getTime() + 1000) : new Date();
  const remain = Math.max(0, Math.floor((drawTime - now) / 1000));

  const m = Math.floor(remain / 60);
  const sec = remain % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;

  let tstr;
  if (h > 0) {
    tstr = pad0(h) + ':' + pad0(mm) + ':' + pad0(sec);
  } else {
    tstr = pad0(mm) + ':' + pad0(sec);
  }

  document.getElementById('countdownTime').textContent = tstr;
  document.getElementById('drawTime').textContent =
    pad0(drawTime.getHours()) + ':' + pad0(drawTime.getMinutes()) + ':' + pad0(drawTime.getSeconds());

  const serverEl = document.getElementById('serverTime');
  if (baseTime) {
    serverEl.textContent = '服务器';
  } else {
    serverEl.textContent = '本地';
  }
}

function pad0(n) {
  return n < 10 ? '0' + n : '' + n;
}

// ==================== 自动刷新 ====================

function setupAutoRefresh() {
  if (AppState.refreshTimer) {
    clearInterval(AppState.refreshTimer);
    AppState.refreshTimer = null;
  }

  if (AppState.autoRefresh) {
    AppState.refreshTimer = setInterval(async () => {
      await loadLiveData();
      generatePredictions();
    }, 5000);
  }
}

// ==================== 预测生成 ====================

function generatePredictions() {
  if (!AppState.adapter || !AppState.sequences) return;

  try {
    _generatePredictionsInner();
  } catch (e) {
    console.error('预测生成失败:', e);
    const predSection = document.getElementById('predSection');
    if (predSection) {
      predSection.innerHTML =
        '<div class="loading-text" style="color:#c41e3a;">预测生成失败：' +
        (e.message || '未知错误') +
        '<br><small>请刷新页面试试</small></div>';
    }
    // 出错时也隐藏组合和位置的加载状态
    document.getElementById('comboPredSection').style.display = 'none';
    document.getElementById('positionPredSection').style.display = 'none';
  }
}

function _generatePredictionsInner() {
  const sequences = AppState.sequences;
  const predictions = {};
  const rt = AppState.liveData;
  // 预测的是下期（待开奖期），不是当前已开奖期
  const predIssue = rt ? String(rt['下期期号'] || '') : '';
  const currentIssue = rt ? String(rt['期号'] || '') : '';

  // v4 新增：获取 EWMA 评分（如果启用）
  const ewmaMgr = AppState.ewmaMgr;
  const lotCode = AppState.currentConfig.code;
  const ewmaEnabled = Settings.ewmaEnabled && ewmaMgr;

  // 大小、单双预测
  const algoPredictionsAll = {}; // 存储所有算法结果用于对比
  for (const category of ['大小', '单双']) {
    const seq = sequences[category];
    if (!seq || seq.length < 3) continue;

    const labels = AppState.adapter.getLabels(category);
    const catKey = category === '大小' ? 'dx' : 'ds';

    // v5.0 新增：生成所有算法的预测结果
    const allAlgoResults = generateAllAlgoPredictions(seq, labels, category);
    algoPredictionsAll[catKey] = allAlgoResults;

    // 根据当前选中的算法选择主预测结果
    let selectedAlgo = AppState.currentAlgo;
    if (selectedAlgo === 'compare') selectedAlgo = 'experience'; // 对比模式默认用经验学习

    const mainResult = allAlgoResults[selectedAlgo] || allAlgoResults.experience;
    const mainProbs = mainResult.final || {};

    // v5.0 新增：计算模型一致性（各算法是否一致）
    const modelAgreement = computeModelAgreementFromAlgos(allAlgoResults, labels);

    // v5.0 新增：获取历史命中率（用于置信度计算）
    let historicalRate = null;
    try {
      const stats = PredictionStats.getStats(lotCode);
      const catStats = stats.summary && stats.summary.byCategory && stats.summary.byCategory[category];
      if (catStats && catStats.total > 0) {
        historicalRate = catStats.rate;
      }
    } catch (e) {}

    // v5.0 新增：增强版置信度计算
    const enhancedConf = computeEnhancedConfidence(mainProbs, labels, {
      sampleSize: mainResult.sample || 0,
      modelAgreement: modelAgreement,
      historicalRate: historicalRate,
      category: 'binary',
    });

    // v5.0 新增：谨慎预测判定
    const cautiousResult = shouldBeCautious(mainProbs, labels, {
      sampleSize: mainResult.sample || 0,
      modelAgreement: modelAgreement,
      confidenceScore: enhancedConf.score,
      recentStreak: AppState.lastStatsStreak || 0,
      category: 'binary',
    });

    // 构建预测结果
    predictions[category] = {
      lean: mainResult.lean || '-',
      pct: mainResult.pct || 0,
      sample: mainResult.sample || 0,
      pattern: mainResult.pattern ? mainResult.pattern.join('') : '',
      confidence: enhancedConf.label,
      confidenceScore: enhancedConf.score,
      confidenceLevel: enhancedConf.level,
      cautious: cautiousResult.cautious,
      cautiousReasons: cautiousResult.reasons,
      modelName: mainResult.modelName || (selectedAlgo === 'experience' ? '经验学习' : selectedAlgo === 'pattern' ? '形态匹配' : '手动标记'),
      modelScore: mainResult.modelScore || 0,
      pValue: mainResult.pValue !== undefined ? mainResult.pValue : 1.0,
      significant: mainResult.significant || false,
      topN: mainResult.topN || [],
      details: mainResult.details || [],
      probs: mainProbs,
      enhancedConfidence: enhancedConf,
    };

    // 保存到本地存储（预测期号 = 下期期号）
    Storage.upsertPrediction({
      key: AppState.adapter.predKey,
      issue: predIssue,
      category: category,
      pattern: mainResult.pattern ? mainResult.pattern.join('') : '',
      lean: mainResult.lean,
      sample: Math.round(mainResult.sample || 0),
      pct: mainResult.pct,
      result: '待开',
      time: new Date().toLocaleString('zh-CN'),
      confidence: enhancedConf.level,
      modelName: mainResult.modelName || '',
      modelScore: mainResult.modelScore || 0,
    });
  }

  // v5.0 新增：存储所有算法结果
  AppState.algoPredictions = algoPredictionsAll;

  renderPredictions(predictions, predIssue);

  // v5.0 新增：渲染置信度横幅（用大小分类的置信度）
  const firstPred = predictions['大小'] || predictions['单双'];
  if (firstPred && firstPred.enhancedConfidence) {
    renderConfidenceBanner(firstPred.enhancedConfidence);
  }

  // v5.0 新增：渲染算法对比面板（如果是对比模式或一直显示）
  if (AppState.currentAlgo === 'compare') {
    const dxResults = algoPredictionsAll['dx'] || {};
    renderAlgoComparison(dxResults, '大小');
  }

  // v5.2 新增：更新融合权重条形图
  if (AppState.currentAlgo === 'fusion') {
    updateFusionWeightBars();
  }

  // v5.1 新增：刷新手动标记的当前形态和列表
  try {
    updateCurrentPattern();
    updateMarksList();
  } catch (e) {}

  // v5.3 增强：组合预测（支持多算法切换 + 智能融合）
  if (sequences['组合']) {
    const comboSeq = sequences['组合'];
    const comboLabels = AppState.adapter.getLabels('组合');
    const sumRange = AppState.adapter.getSumRange ? AppState.adapter.getSumRange() : { min: 3, max: 19 };
    const topN = Settings.zuheTopN || 3;
    const comboAlgo = AppState.currentComboAlgo;

    // 生成所有算法结果
    const comboAllAlgos = {};
    const comboAlgoList = ComboPredictorFactory.getAvailableAlgos();

    for (const algoInfo of comboAlgoList) {
      try {
        const predictor = ComboPredictorFactory.get(algoInfo.id);
        const ewmaMgr = AppState.ewmaMgr;
        const ewmaScores = ewmaMgr && ewmaMgr._scores && ewmaMgr._scores[lotCode]
          ? ewmaMgr._scores[lotCode]['组合'] || {}
          : {};

        let result;
        if (algoInfo.id === 'fusion') {
          const fusionConfig = FusionMultiConfig.getCategory('combo');
          result = predictor.predict(comboSeq, comboLabels, {
            sumSeq: AppState.sumSequence,
            sumMin: sumRange.min,
            sumMax: sumRange.max,
            topN,
            fusionStrategy: fusionConfig.strategy,
            enabledModels: fusionConfig.enabledModels,
            ewmaScores,
            ewmaMgr,
            category: '组合',
          });
        } else {
          result = predictor.predict(comboSeq, comboLabels, {
            sumSeq: AppState.sumSequence,
            sumMin: sumRange.min,
            sumMax: sumRange.max,
            ewmaScores: ewmaEnabled ? ewmaScores : null,
            topN,
          });
        }
        comboAllAlgos[algoInfo.id] = result;
      } catch (e) {
        console.warn(`组合${algoInfo.name}算法失败:`, e);
        comboAllAlgos[algoInfo.id] = {
          lean: '', pct: 0, sample: 0, final: {}, topN: [], confidence: '低', details: [],
        };
      }
    }

    const mainResult = comboAllAlgos[comboAlgo] || comboAllAlgos['experience'];

    AppState.comboPrediction = {
      lean: mainResult.lean,
      pct: mainResult.pct,
      sample: mainResult.sample,
      confidence: mainResult.confidence,
      modelName: mainResult.modelName || '',
      pValue: mainResult.pValue !== undefined ? mainResult.pValue : 1.0,
      significant: mainResult.significant || false,
      top3: mainResult.topN || [],
      allProbs: mainResult.final || {},
      details: mainResult.details || [],
      allAlgos: comboAllAlgos,
      currentAlgo: comboAlgo,
      weights: mainResult.weights || [],
      subPredictions: mainResult.subPredictions || [],
    };

    // 保存组合预测
    Storage.upsertPrediction({
      key: AppState.adapter.predKey,
      issue: predIssue,
      category: '组合',
      lean: mainResult.lean,
      top3: (mainResult.topN || []).map(t => t.label),
      sample: Math.round(mainResult.sample || 0),
      pct: mainResult.pct,
      result: '待开',
      time: new Date().toLocaleString('zh-CN'),
      confidence: mainResult.confidence,
      modelName: mainResult.modelName || '',
      modelScore: 0,
    });

    renderComboPredMulti(AppState.comboPrediction, predIssue);
  } else {
    document.getElementById('comboPredSection').style.display = 'none';
  }

  // v5.3 增强：位置号码预测（支持多算法切换 + 智能融合）
  const posConfig = AppState.adapter.positionConfig;
  if (posConfig && posConfig.enabled) {
    const posPreds = {};
    const posTopN = Settings.positionTopN || 3;
    const posAlgo = AppState.currentPosAlgo;
    const posAlgoList = PosPredictorFactory.getAvailableAlgos();
    const fusionConfig = FusionMultiConfig.getCategory('position');

    for (let i = 0; i < posConfig.positions.length; i++) {
      const pos = posConfig.positions[i];
      const seq = sequences[pos.seqKey];
      if (!seq || seq.length < 5) continue;

      const labels = AppState.adapter.getLabels(pos.key);

      // 生成所有算法结果
      const allAlgoResults = {};
      for (const algoInfo of posAlgoList) {
        try {
          const predictor = PosPredictorFactory.get(algoInfo.id, i);
          const ewmaMgr = AppState.ewmaMgr;
          const ewmaScores = ewmaMgr && ewmaMgr._scores && ewmaMgr._scores[lotCode]
            ? ewmaMgr._scores[lotCode][pos.key] || {}
            : {};

          let result;
          if (algoInfo.id === 'fusion') {
            result = predictor.predict(seq, labels, {
              topN: posTopN,
              fusionStrategy: fusionConfig.strategy,
              enabledModels: fusionConfig.enabledModels,
              ewmaScores,
              ewmaMgr,
              category: pos.key,
            });
          } else {
            result = predictor.predict(seq, labels, {
              ewmaScores: ewmaEnabled ? ewmaScores : {},
              modelCandidates: MODEL_CANDIDATES,
              topN: posTopN,
            });
          }
          allAlgoResults[algoInfo.id] = result;
        } catch (e) {
          console.warn(`位置${pos.name} ${algoInfo.name}算法失败:`, e);
          allAlgoResults[algoInfo.id] = {
            lean: '', pct: 0, sample: 0, final: {}, topN: [], confidence: '低', details: [],
          };
        }
      }

      const mainResult = allAlgoResults[posAlgo] || allAlgoResults['experience'];
      const topPicks = (mainResult.topN || []).slice(0, Math.min(posTopN, (mainResult.topN || []).length));

      posPreds[pos.key] = {
        name: pos.name,
        topN: topPicks,
        top3: topPicks.slice(0, 3),
        sample: mainResult.sample,
        confidence: mainResult.confidence,
        modelName: mainResult.modelName || '',
        details: mainResult.details || [],
        allAlgos: allAlgoResults,
        currentAlgo: posAlgo,
        weights: mainResult.weights || [],
        subPredictions: mainResult.subPredictions || [],
      };

      // 保存位置预测
      Storage.upsertPrediction({
        key: AppState.adapter.predKey,
        issue: predIssue,
        category: pos.name,
        lean: mainResult.lean,
        top3: topPicks.map(t => t.label),
        sample: Math.round(mainResult.sample || 0),
        pct: mainResult.pct,
        result: '待开',
        time: new Date().toLocaleString('zh-CN'),
        confidence: mainResult.confidence,
        modelName: mainResult.modelName || '',
        isPosition: true,
      });
    }
    AppState.positionPredictions = posPreds;
    renderPositionPredMulti(posPreds, predIssue);
  } else {
    document.getElementById('positionPredSection').style.display = 'none';
  }
}

// ==================== 预测渲染 ====================

function renderPredictions(predictions, predIssue) {
  const container = document.getElementById('predSection');
  const categories = Object.keys(predictions);

  if (categories.length === 0) {
    container.innerHTML = '<div class="loading-text">数据不足，无法生成预测</div>';
    return;
  }

  // v5.1 新增：当前算法图标
  const algoIcons = {
    '经验学习': '🎯',
    '形态匹配': '📊',
    '手动标记': '✍️',
  };

  let html = '';
  if (predIssue) {
    html += '<div class="pred-issue-label">🎯 预测第 <b>' + predIssue + '</b> 期</div>';
  }
  for (const cat of categories) {
    const p = predictions[cat];
    const sigClass = p.significant ? 'sig-ok' : 'sig-bad';
    const sigText = p.significant ? '显著' : '不显著';
    const pValStr = (p.pValue !== undefined && p.pValue !== null) ? p.pValue.toFixed(3) : '-';
    const algoIcon = algoIcons[p.modelName] || '🎯';

    // v5.1 新增：谨慎提示
    let cautiousHtml = '';
    if (p.cautious && p.cautiousReasons && p.cautiousReasons.length > 0) {
      cautiousHtml = '<div class="pred-cautious">⚠️ ' + p.cautiousReasons.join('、') + '</div>';
    }

    html += '<div class="pred-card">';
    html += '<h4>' + algoIcon + ' ' + cat + ' · ' + p.modelName + '</h4>';
    html += '<div class="pred-p">p=' + pValStr + ' <span class="' + sigClass + '">' + sigText + '</span></div>';
    html += '<div class="pred-lean">';
    html += '倾向：<b>' + p.lean + '</b>（' + p.pct + '%）<br>';
    html += '样本：' + Math.round(p.sample || 0) + ' · 置信度：<b>' + p.confidence + '</b>';
    html += '</div>';
    html += cautiousHtml;
    html += '</div>';
  }

  // v5.1 新增：手动标记模式的提示
  if (AppState.currentAlgo === 'manual') {
    html += '<div class="manual-hint">✍️ <b>手动标记模式</b>：预测基于您的标记数据。' +
      '<a href="javascript:void(0)" onclick="switchToManualSettings()">去设置标记 →</a></div>';
  }

  container.innerHTML = html;
}

// v5.1 新增：跳转到手动标记设置
function switchToManualSettings() {
  switchPage('settings');
  // 滚动到手动标记区域
  setTimeout(() => {
    const el = document.getElementById('manualMarksSection');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

// 组合 Top3 渲染
function renderComboPredTop3(comboPred, predIssue) {
  const container = document.getElementById('comboPredSection');
  const top3 = comboPred.top3 || [];

  if (top3.length === 0) {
    container.style.display = 'none';
    return;
  }

  let top3Html = '';
  top3.forEach((item, idx) => {
    const rankClass = 'rank-' + (idx + 1);
    top3Html += '<div class="combo-top-item ' + rankClass + '">';
    top3Html += '<div class="combo-rank">' + (idx + 1) + '</div>';
    top3Html += '<div class="combo-label">' + item.label + '</div>';
    top3Html += '<div class="combo-pct">' + item.pct + '%</div>';
    top3Html += '</div>';
  });

  const allList = Object.entries(comboPred.allProbs || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + ' ' + v + '%')
    .join(' · ');

  const sigClass = comboPred.significant ? 'sig-ok' : 'sig-bad';
  const sigText = comboPred.significant ? '显著' : '不显著';

  const issueHtml = predIssue ? '<div class="pred-issue-label" style="margin-bottom:8px;">🎯 预测第 <b>' + predIssue + '</b> 期（组合Top3）</div>' : '';

  container.style.display = 'block';
  container.innerHTML =
    '<div class="combo-pred-section">' +
    issueHtml +
    '<h4>🏆 组合预测（独立模型）<span class="combo-model">' + comboPred.modelName + ' · p=' + comboPred.pValue.toFixed(3) + ' ' + sigText + '</span></h4>' +
    '<div class="combo-top3">' + top3Html + '</div>' +
    '<div class="combo-all-list">全部：' + allList + '</div>' +
    '<div class="combo-all-list" style="margin-top:4px;color:var(--text-muted);">样本：' + comboPred.sample + ' · 置信度：<b>' + comboPred.confidence + '</b></div>' +
    '</div>';
}

// 位置预测渲染
function renderPositionPred(posPreds, predIssue) {
  const container = document.getElementById('positionPredSection');
  const positions = Object.values(posPreds);

  if (positions.length === 0) {
    container.style.display = 'none';
    return;
  }

  const topN = Settings.positionTopN || 3;

  let cardsHtml = '';
  for (const pos of positions) {
    const topPicks = pos.topN || pos.top3 || [];
    let numsHtml = '';
    topPicks.forEach((item, idx) => {
      const topClass = idx < 3 ? 'top' + (idx + 1) : 'top-other';
      const label = item.label !== undefined ? item.label : String(item.number || '');
      numsHtml += '<div class="pos-num-ball ' + topClass + '">' + String(label).padStart(2, '0') + '</div>';
      numsHtml += '<div class="pos-num-pct">' + (item.pct || 0).toFixed(1) + '%</div>';
    });

    cardsHtml += '<div class="position-card">';
    cardsHtml += '<div class="position-name">' + pos.name + '</div>';
    cardsHtml += '<div class="position-nums">' + numsHtml + '</div>';
    cardsHtml += '</div>';
  }

  const issueHtml = predIssue ? '<div class="pred-issue-label" style="margin-bottom:8px;">🎯 预测第 <b>' + predIssue + '</b> 期（位置号码）</div>' : '';

  container.style.display = 'block';
  container.innerHTML =
    '<div class="position-pred-section">' +
    issueHtml +
    '<h4>🎯 位置号码预测（Top' + topN + '）</h4>' +
    '<div class="position-cards">' + cardsHtml + '</div>' +
    '<div class="combo-all-list" style="margin-top:6px;">各位置预测出现概率最高的' + topN + '个号码，仅供参考</div>' +
    '</div>';
}

// ==================== v5.3 新增：组合预测多算法渲染 ====================

function renderComboPredMulti(comboPred, predIssue) {
  const container = document.getElementById('comboPredSection');
  if (!container) return;

  const top3 = comboPred.top3 || [];
  if (top3.length === 0) {
    container.style.display = 'none';
    return;
  }

  const algoList = ComboPredictorFactory.getAvailableAlgos();
  const currentAlgo = comboPred.currentAlgo || 'experience';

  // 算法切换标签
  let tabsHtml = '<div class="sub-algo-tabs">';
  for (const algo of algoList) {
    const activeClass = currentAlgo === algo.id ? 'active' : '';
    tabsHtml += '<button class="sub-algo-tab ' + activeClass + '" data-combo-algo="' + algo.id + '">';
    tabsHtml += '<span class="sub-algo-tab-icon">' + algo.icon + '</span>';
    tabsHtml += algo.name;
    tabsHtml += '</button>';
  }
  tabsHtml += '</div>';

  // Top3 展示
  let top3Html = '';
  top3.forEach((item, idx) => {
    const rankClass = 'rank-' + (idx + 1);
    top3Html += '<div class="combo-top-item ' + rankClass + '">';
    top3Html += '<div class="combo-rank">' + (idx + 1) + '</div>';
    top3Html += '<div class="combo-label">' + item.label + '</div>';
    top3Html += '<div class="combo-pct">' + item.pct + '%</div>';
    top3Html += '</div>';
  });

  const allList = Object.entries(comboPred.allProbs || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + ' ' + (typeof v === 'number' ? v.toFixed(1) : v) + '%')
    .join(' · ');

  const sigClass = comboPred.significant ? 'sig-ok' : 'sig-bad';
  const sigText = comboPred.significant ? '显著' : '不显著';
  const pValue = comboPred.pValue !== undefined ? comboPred.pValue : 1.0;

  const issueHtml = predIssue ? '<div class="pred-issue-label" style="margin-bottom:8px;">🎯 预测第 <b>' + predIssue + '</b> 期（组合Top3）</div>' : '';

  // 融合设置（仅融合模式显示）
  let fusionSettingsHtml = '';
  if (currentAlgo === 'fusion') {
    fusionSettingsHtml = renderComboFusionSettings('combo');
  }

  container.style.display = 'block';
  container.innerHTML =
    '<div class="combo-pred-section">' +
    issueHtml +
    tabsHtml +
    '<h4>🏆 组合预测 <span class="combo-model">' + (comboPred.modelName || '') + ' · p=' + pValue.toFixed(3) + ' ' + sigText + '</span></h4>' +
    '<div class="combo-top3">' + top3Html + '</div>' +
    '<div class="combo-all-list">全部：' + allList + '</div>' +
    '<div class="combo-all-list" style="margin-top:4px;color:var(--text-muted);">样本：' + comboPred.sample + ' · 置信度：<b>' + comboPred.confidence + '</b></div>' +
    fusionSettingsHtml +
    '</div>';

  // 绑定算法切换事件
  container.querySelectorAll('[data-combo-algo]').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.currentComboAlgo = btn.dataset.comboAlgo;
      generatePredictions();
    });
  });

  // 绑定融合设置事件
  bindComboFusionEvents('combo');
}

// ==================== v5.3 新增：位置预测多算法渲染 ====================

function renderPositionPredMulti(posPreds, predIssue) {
  const container = document.getElementById('positionPredSection');
  if (!container) return;

  const positions = Object.values(posPreds);
  if (positions.length === 0) {
    container.style.display = 'none';
    return;
  }

  const topN = Settings.positionTopN || 3;
  const algoList = PosPredictorFactory.getAvailableAlgos();
  const currentAlgo = positions[0]?.currentAlgo || 'experience';

  // 算法切换标签
  let tabsHtml = '<div class="sub-algo-tabs">';
  for (const algo of algoList) {
    const activeClass = currentAlgo === algo.id ? 'active' : '';
    tabsHtml += '<button class="sub-algo-tab ' + activeClass + '" data-pos-algo="' + algo.id + '">';
    tabsHtml += '<span class="sub-algo-tab-icon">' + algo.icon + '</span>';
    tabsHtml += algo.name;
    tabsHtml += '</button>';
  }
  tabsHtml += '</div>';

  // 位置卡片
  let cardsHtml = '';
  for (const pos of positions) {
    const topPicks = pos.topN || pos.top3 || [];
    let numsHtml = '';
    topPicks.forEach((item, idx) => {
      const topClass = idx < 3 ? 'top' + (idx + 1) : 'top-other';
      const label = item.label !== undefined ? item.label : String(item.number || '');
      numsHtml += '<div class="pos-num-ball ' + topClass + '">' + String(label).padStart(2, '0') + '</div>';
      numsHtml += '<div class="pos-num-pct">' + (item.pct || 0).toFixed(1) + '%</div>';
    });

    cardsHtml += '<div class="position-card">';
    cardsHtml += '<div class="position-name">' + pos.name + '</div>';
    cardsHtml += '<div class="position-nums">' + numsHtml + '</div>';
    cardsHtml += '</div>';
  }

  const issueHtml = predIssue ? '<div class="pred-issue-label" style="margin-bottom:8px;">🎯 预测第 <b>' + predIssue + '</b> 期（位置号码）</div>' : '';

  // 融合设置（仅融合模式显示）
  let fusionSettingsHtml = '';
  if (currentAlgo === 'fusion') {
    fusionSettingsHtml = renderComboFusionSettings('position');
  }

  container.style.display = 'block';
  container.innerHTML =
    '<div class="position-pred-section">' +
    issueHtml +
    tabsHtml +
    '<h4>🎯 位置号码预测（Top' + topN + '）</h4>' +
    '<div class="position-cards">' + cardsHtml + '</div>' +
    '<div class="combo-all-list" style="margin-top:6px;">各位置预测出现概率最高的' + topN + '个号码，仅供参考</div>' +
    fusionSettingsHtml +
    '</div>';

  // 绑定算法切换事件
  container.querySelectorAll('[data-pos-algo]').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.currentPosAlgo = btn.dataset.posAlgo;
      generatePredictions();
    });
  });

  // 绑定融合设置事件
  bindComboFusionEvents('position');
}

// 渲染融合设置（精简版，用于组合和位置小节）
function renderComboFusionSettings(category) {
  const config = FusionMultiConfig.getCategory(category);
  const models = getAdvancedModelList();
  const strategies = [
    { id: 'ewma', name: 'EWMA', icon: '📈' },
    { id: 'equal', name: '等权', icon: '⚖️' },
    { id: 'confidence', name: '置信度', icon: '🎯' },
    { id: 'consensus', name: '投票', icon: '🗳️' },
  ];

  let html = '<div class="combo-fusion-settings">';
  html += '<div class="combo-fusion-title">';
  html += '<span>🔮 融合设置</span>';
  html += '</div>';

  // 策略选择
  html += '<div class="combo-fusion-strategy-row">';
  for (const s of strategies) {
    const activeClass = config.strategy === s.id ? 'active' : '';
    html += '<button class="combo-fs-btn ' + activeClass + '" data-fs-category="' + category + '" data-fs-strategy="' + s.id + '">';
    html += s.icon + ' ' + s.name;
    html += '</button>';
  }
  html += '</div>';

  // 模型选择（chip形式）
  html += '<div class="combo-fusion-title" style="margin-top:4px;"><span>参与模型</span></div>';
  html += '<div class="combo-fusion-models">';
  for (const m of models) {
    const isActive = config.enabledModels.includes(m.id);
    const activeClass = isActive ? 'active' : '';
    html += '<span class="combo-fm-chip ' + activeClass + '" data-fm-category="' + category + '" data-fm-id="' + m.id + '">';
    html += m.icon + ' ' + m.shortName;
    html += '</span>';
  }
  html += '</div>';

  // 权重分布
  if (category === 'combo' && AppState.comboPrediction && AppState.comboPrediction.weights) {
    html += renderMiniWeightBars(AppState.comboPrediction.subPredictions, AppState.comboPrediction.weights);
  } else if (category === 'position') {
    const firstPos = Object.values(AppState.positionPredictions || {})[0];
    if (firstPos && firstPos.weights) {
      html += renderMiniWeightBars(firstPos.subPredictions, firstPos.weights);
    }
  }

  html += '</div>';
  return html;
}

// 渲染迷你权重条形图
function renderMiniWeightBars(subPreds, weights) {
  if (!subPreds || subPreds.length === 0) {
    return '<div style="font-size:11px;color:var(--text-light);text-align:center;margin-top:8px;">暂无选中的模型</div>';
  }

  let html = '<div style="margin-top:10px;">';
  html += '<div style="font-size:11px;font-weight:bold;color:var(--text);margin-bottom:6px;">权重分布</div>';
  for (let i = 0; i < subPreds.length; i++) {
    const pred = subPreds[i];
    const w = weights[i] || 0;
    const wPct = Math.round(w * 100 * 10) / 10;
    const name = pred.modelName || pred.name || '模型' + (i + 1);
    const shortName = name.length > 6 ? name.substring(0, 6) + '…' : name;

    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
    html += '<div style="font-size:10px;color:var(--text);width:60px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + name + '">' + shortName + '</div>';
    html += '<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden;">';
    html += '<div style="height:100%;background:linear-gradient(90deg,#8b5cf6,#6366f1);border-radius:3px;width:' + wPct + '%;"></div>';
    html += '</div>';
    html += '<div style="font-size:10px;color:var(--text-light);width:36px;text-align:right;">' + wPct + '%</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// 绑定融合设置事件（组合/位置通用）
function bindComboFusionEvents(category) {
  // 策略切换
  document.querySelectorAll('[data-fs-category="' + category + '"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const strategy = btn.dataset.fsStrategy;
      FusionMultiConfig.updateStrategy(category, strategy);
      generatePredictions();
    });
  });

  // 模型chip切换
  document.querySelectorAll('[data-fm-category="' + category + '"]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const modelId = chip.dataset.fmId;
      FusionMultiConfig.toggleModel(category, modelId);
      generatePredictions();
    });
  });
}

// ==================== 结算 ====================

function settlePredictions(rt) {
  if (!AppState.adapter) return;

  const issue = String(rt['期号'] || '');
  if (issue === AppState.lastSettledIssue) return;
  AppState.lastSettledIssue = issue;

  const actualMap = {};
  for (const cat of AppState.adapter.defaultCategories) {
    const actual = AppState.adapter.getActual(rt, cat);
    if (actual) actualMap[cat] = actual;
  }

  // 组合实际值
  if (actualMap['大小'] && actualMap['单双']) {
    actualMap['组合'] = actualMap['大小'] + actualMap['单双'];
  }

  // 位置实际值
  const posConfig = AppState.adapter.positionConfig;
  if (posConfig && posConfig.enabled) {
    for (const pos of posConfig.positions) {
      const actual = AppState.adapter.getActual(rt, pos.key);
      if (actual) actualMap[pos.name] = actual;
    }
  }

  // 从存储中加载待结算的记录
  const records = Storage.loadPredictions(AppState.adapter.predKey, 100);

  // v4 新增：准备 EWMA 更新数据
  const ewmaMgr = AppState.ewmaMgr;
  const lotCode = AppState.currentConfig ? AppState.currentConfig.code : null;
  const ewmaUpdates = {}; // { category: { modelName: isCorrect } }

  for (const r of records) {
    if (r.result !== '待开') continue;
    if (!actualMap[r.category] && !r.isPosition) continue;

    try {
      const oldI = parseInt(r.issue);
      const newI = parseInt(issue);
      // 预测期号 > 当前已开奖期号：还没开，跳过
      // 预测期号 <= 当前已开奖期号：已开奖，可以结算
      if (oldI > newI) continue;
    } catch (e) {
      if (r.issue > issue) continue;
    }

    const actual = actualMap[r.category];
    let result;

    // 组合/位置类：如果有top3，用top3判断（包含即对）
    if (r.top3 && r.top3.length > 0) {
      const actualStr = String(actual);
      result = r.top3.map(String).includes(actualStr) ? '对' : '错';
    } else {
      result = actual === r.lean ? '对' : '错';
    }

    Storage.settlePrediction(AppState.adapter.predKey, r.issue, r.category, actual, result, issue);
  }

  // v4 新增：更新 EWMA 评分
  if (ewmaMgr && lotCode && Settings.ewmaEnabled) {
    updateEwmaScoresAfterSettle(rt, actualMap);
  }
}

// v4 新增：开奖后更新各模型的 EWMA 评分
async function updateEwmaScoresAfterSettle(rt, actualMap) {
  if (!AppState.ewmaMgr || !AppState.currentConfig) return;
  if (!AppState.sequences || !AppState.historyRows) return;

  const lotCode = AppState.currentConfig.code;
  const ewmaMgr = AppState.ewmaMgr;
  const sequences = AppState.sequences;

  try {
    // 确保 EWMA 已加载
    await ewmaMgr._ensureLoaded(lotCode);

    // 1. 大小、单双：各模型预测对错
    for (const category of ['大小', '单双']) {
      const seq = sequences[category];
      if (!seq || seq.length < 5) continue;

      // 注意：结算的是"上期预测"，所以要用开奖前的序列（去掉最后一期）来生成预测
      const histSeq = seq.slice(0, -1);
      if (histSeq.length < 3) continue;

      const labels = AppState.adapter.getLabels(category);
      const preds = getAllModelPredictions(histSeq, labels, MODEL_CANDIDATES);

      const actual = actualMap[category];
      if (!actual) continue;

      const results = {};
      for (const [modelName, pred] of Object.entries(preds)) {
        results[modelName] = pred === actual;
      }

      if (Object.keys(results).length > 0) {
        await ewmaMgr.updateScores(lotCode, category, results);
      }
    }

    // 2. 组合：各模型预测对错
    if (sequences['组合'] && actualMap['组合']) {
      const comboSeq = sequences['组合'];
      const histCombo = comboSeq.slice(0, -1);
      if (histCombo.length >= 3) {
        const comboLabels = AppState.adapter.getLabels('组合');
        const sumRange = AppState.adapter.getSumRange ? AppState.adapter.getSumRange() : { min: 3, max: 19 };
        const sumSeq = AppState.sumSequence || [];
        const histSum = sumSeq.slice(0, -1);

        const preds = getZuheModelPredictions(
          histCombo,
          histSum.length === histCombo.length ? histSum : null,
          comboLabels,
          sumRange.min,
          sumRange.max
        );

        const actual = actualMap['组合'];
        const results = {};
        for (const [modelName, pred] of Object.entries(preds)) {
          results[modelName] = pred === actual;
        }

        if (Object.keys(results).length > 0) {
          await ewmaMgr.updateScores(lotCode, '组合', results);
        }
      }
    }

    // 3. 位置预测：各模型预测对错
    const posConfig = AppState.adapter.positionConfig;
    if (posConfig && posConfig.enabled) {
      for (const pos of posConfig.positions) {
        const seq = sequences[pos.seqKey];
        if (!seq || seq.length < 5) continue;

        const histSeq = seq.slice(0, -1);
        if (histSeq.length < 3) continue;

        const labels = AppState.adapter.getLabels(pos.key);
        const preds = getAllModelPredictions(histSeq, labels, MODEL_CANDIDATES);

        const actual = actualMap[pos.name];
        if (!actual) continue;

        const results = {};
        for (const [modelName, pred] of Object.entries(preds)) {
          results[modelName] = pred === actual;
        }

        if (Object.keys(results).length > 0) {
          await ewmaMgr.updateScores(lotCode, pos.key, results);
        }
      }
    }
  } catch (e) {
    console.warn('Update EWMA scores failed:', e);
  }
}

// ==================== 连对连错 ====================

function updateStreakCard() {
  if (!AppState.adapter) return;

  const records = Storage.loadPredictions(AppState.adapter.predKey, 200);
  // 只统计大小单双的标准预测
  const filtered = records.filter(r =>
    (r.category === '大小' || r.category === '单双') &&
    (r.result === '对' || r.result === '错')
  );

  if (filtered.length === 0) {
    document.getElementById('streakCard').style.display = 'none';
    return;
  }

  const streaks = computeStreaks(filtered);

  document.getElementById('streakCard').style.display = 'flex';
  const currentEl = document.getElementById('streakCurrent');
  currentEl.querySelector('.streak-num').textContent = streaks.currentStreak;
  currentEl.querySelector('.streak-label').textContent = '当前' + streaks.currentType;
  currentEl.className = 'streak-item ' + (streaks.currentType === '连对' ? 'win' : 'lose');

  document.getElementById('streakMaxWin').querySelector('.streak-num').textContent = streaks.maxWinStreak;
  document.getElementById('streakMaxLose').querySelector('.streak-num').textContent = streaks.maxLoseStreak;
}

// ==================== 分析页 ====================

function updateAnalysisPage() {
  const activeTab = document.querySelector('.sub-tab.active');
  if (activeTab) {
    updateSubTab(activeTab.dataset.tab);
  }
}

function renderFreqChart() {
  const n = parseInt(document.getElementById('freqN').value);
  const rows = AppState.historyRows.slice(-n);

  if (AppState.currentConfig.type === 'pks') {
    renderPksFreqChart(rows);
  } else {
    renderLuck20FreqChart(rows);
  }
}

function renderLuck20FreqChart(rows) {
  const freq = {};
  for (let i = 1; i <= 80; i++) freq[i] = 0;

  for (const row of rows) {
    for (let i = 1; i <= 20; i++) {
      const num = row['号' + i];
      if (num) freq[num] = (freq[num] || 0) + 1;
    }
  }

  const maxVal = Math.max(...Object.values(freq));
  let barsHtml = '';
  for (let i = 1; i <= 80; i++) {
    const h = maxVal > 0 ? (freq[i] / maxVal * 100) : 0;
    barsHtml += '<div class="freq-bar" style="height:' + h + '%" title="第' + i + '号: ' + freq[i] + '次"><div class="freq-bar-label">' + i + '</div></div>';
  }

  document.getElementById('freqChart').innerHTML = '<div class="freq-bars">' + barsHtml + '</div>';

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const hot = sorted.slice(0, 10).map(x => pad0(x[0])).join(' ');
  const cold = sorted.slice(-10).reverse().map(x => pad0(x[0])).join(' ');

  document.getElementById('hotNums').textContent = hot;
  document.getElementById('coldNums').textContent = cold;
}

function renderPksFreqChart(rows) {
  const freq = {};
  for (let i = 1; i <= 10; i++) freq[i] = 0;

  for (const row of rows) {
    const num = row['冠军'];
    if (num) freq[num] = (freq[num] || 0) + 1;
  }

  const maxVal = Math.max(...Object.values(freq));
  let barsHtml = '';
  for (let i = 1; i <= 10; i++) {
    const h = maxVal > 0 ? (freq[i] / maxVal * 100) : 0;
    barsHtml += '<div class="freq-bar" style="height:' + h + '%;flex:1;min-width:24px;" title="第' + i + '号: ' + freq[i] + '次"><div class="freq-bar-label">' + i + '</div></div>';
  }

  document.getElementById('freqChart').innerHTML =
    '<div style="text-align:center;font-size:12px;color:#8a6d3b;margin-bottom:8px;">冠军号码频率（近' + rows.length + '期）</div>' +
    '<div class="freq-bars" style="min-width:300px;">' + barsHtml + '</div>';

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  document.getElementById('hotNums').textContent = sorted.slice(0, 5).map(x => pad0(x[0])).join(' ');
  document.getElementById('coldNums').textContent = sorted.slice(-5).reverse().map(x => pad0(x[0])).join(' ');
}

function renderSumChart() {
  const n = parseInt(document.getElementById('sumN').value);
  const rows = AppState.historyRows.slice(-n);

  const sumKey = AppState.currentConfig.type === 'pks' ? '冠亚和' : '和值';
  const values = rows.map(r => r[sumKey]);
  const labels = rows.map(r => String(r['期号']).slice(-3));

  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const range = maxVal - minVal || 1;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const w = Math.max(500, values.length * 10);
  const h = 180;
  const padTop = 20;
  const padBottom = 30;
  const chartH = h - padTop - padBottom;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * (w - 20) + 10;
    const y = padTop + chartH - ((v - minVal) / range) * chartH;
    return x + ',' + y;
  }).join(' ');

  const avgY = padTop + chartH - ((avg - minVal) / range) * chartH;

  let svg = '<svg class="sum-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
  svg += '<line x1="10" y1="' + avgY + '" x2="' + (w - 10) + '" y2="' + avgY + '" stroke="#c41e3a" stroke-width="1" stroke-dasharray="4,4"/>';
  svg += '<text x="' + (w - 10) + '" y="' + (avgY - 4) + '" text-anchor="end" fill="#c41e3a" font-size="10">均值 ' + avg.toFixed(1) + '</text>';
  svg += '<polyline points="' + points + '" fill="none" stroke="#c41e3a" stroke-width="2"/>';

  values.forEach((v, i) => {
    const x = (i / (values.length - 1 || 1)) * (w - 20) + 10;
    const y = padTop + chartH - ((v - minVal) / range) * chartH;
    svg += '<circle cx="' + x + '" cy="' + y + '" r="2.5" fill="#c41e3a"/>';
  });

  svg += '</svg>';

  document.getElementById('sumChart').innerHTML = svg;
}

function renderBsPies() {
  const seqDx = AppState.sequences['大小'] || [];
  const seqDs = AppState.sequences['单双'] || [];
  const seqCombo = AppState.sequences['组合'] || [];

  renderPie('pieDx', countValues(seqDx), { '大': '#e63946', '小': '#457b9d' });
  renderPie('pieDs', countValues(seqDs), { '单': '#e63946', '双': '#2a9d8f' });

  if (seqCombo.length > 0) {
    renderPie('pieCombo', countValues(seqCombo), {
      '大单': '#e63946', '大双': '#f4a261', '小单': '#2a9d8f', '小双': '#264653'
    });
  }
}

function countValues(arr) {
  const count = {};
  for (const v of arr) count[v] = (count[v] || 0) + 1;
  return count;
}

function renderPie(containerId, data, colors) {
  const container = document.getElementById(containerId);
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) {
    container.innerHTML = '<div style="text-align:center;color:#aaa;padding:40px 0;">无数据</div>';
    return;
  }

  const entries = Object.entries(data);
  let cumulative = 0;
  const paths = [];

  for (const [label, value] of entries) {
    const startAngle = cumulative / total * Math.PI * 2 - Math.PI / 2;
    cumulative += value;
    const endAngle = cumulative / total * Math.PI * 2 - Math.PI / 2;

    const x1 = 60 + 50 * Math.cos(startAngle);
    const y1 = 60 + 50 * Math.sin(startAngle);
    const x2 = 60 + 50 * Math.cos(endAngle);
    const y2 = 60 + 50 * Math.sin(endAngle);

    const largeArc = value / total > 0.5 ? 1 : 0;
    const color = colors[label] || '#999';

    paths.push(
      '<path d="M60,60 L' + x1 + ',' + y1 + ' A50,50 0 ' + largeArc + ',1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '"/>'
    );
  }

  let svg = '<svg viewBox="0 0 120 120" width="120" height="120">';
  svg += paths.join('');
  svg += '<circle cx="60" cy="60" r="28" fill="#fffef8"/>';
  svg += '<text x="60" y="57" text-anchor="middle" font-size="11" fill="#8a6d3b">共' + total + '</text>';
  svg += '<text x="60" y="70" text-anchor="middle" font-size="10" fill="#a89878">期</text>';
  svg += '</svg>';

  let legendHtml = '<div class="pie-legend">';
  for (const [label, value] of entries) {
    const pct = (value / total * 100).toFixed(1);
    legendHtml += '<div class="pie-legend-item"><span class="pie-legend-dot" style="background:' + (colors[label] || '#999') + '"></span>' + label + ' ' + pct + '%</div>';
  }
  legendHtml += '</div>';

  container.innerHTML = svg + legendHtml;
}

// ==================== 路珠 ====================

function renderLuzhu() {
  const mode = document.querySelector('input[name="luzhuMode"]:checked').value;
  const n = parseInt(document.getElementById('luzhuN').value);
  const seq = AppState.sequences[mode] || [];

  if (seq.length < 3) {
    document.getElementById('luzhuDisplay').innerHTML =
      '<div style="text-align:center;color:#aaa;">历史不足，至少需 3 期</div>';
    return;
  }

  const recentSeq = seq.slice(-n);
  const colors = {
    '大': '#e63946', '小': '#457b9d',
    '单': '#e63946', '双': '#2a9d8f',
    '大单': '#e63946', '大双': '#f4a261', '小单': '#2a9d8f', '小双': '#264653',
  };

  let html = '';
  for (const v of recentSeq) {
    const color = colors[v] || '#333';
    html += '<span style="color:' + color + ';font-weight:700;margin-right:2px;">' + v + '</span>';
  }

  document.getElementById('luzhuDisplay').innerHTML = html;

  updatePatternTail();

  const labels = AppState.adapter.getLabels(mode);
  const model = adaptivePatternModel(seq, labels, [3, 4, 5, 6]);

  const top3 = (model.topN || []).slice(0, 3);
  const top3Html = top3.map(t => t.label + '(' + t.pct + '%)').join(' · ');

  document.getElementById('adaptiveResult').innerHTML =
    '<b>自适应预测：</b>' +
    '<span style="color:#c41e3a;font-weight:800;">' + model.lean + '</span>（' + model.pct + '%）' +
    '<br>样本：' + model.sample + ' · 置信度：<b>' + model.confidence + '</b>' +
    '<br>形态：' + (model.pattern ? model.pattern.join(' → ') : '-') +
    (top3.length > 1 ? '<br>Top3：' + top3Html : '');
}

function updatePatternTail() {
  const mode = document.querySelector('input[name="luzhuMode"]:checked').value;
  const len = parseInt(document.getElementById('patLen').value);
  const seq = AppState.sequences[mode] || [];
  const tail = seq.slice(-len);

  document.getElementById('patTail').innerHTML =
    '末尾 ' + len + ' 期：<b>' + tail.join(' → ') + '</b> → 最新 <b>' + (seq[seq.length - 1] || '-') + '</b>';

  const input = document.getElementById('patInput');
  if (mode !== '组合') {
    input.value = tail.join('');
  } else {
    input.value = '';
  }
}

function queryPattern() {
  const mode = document.querySelector('input[name="luzhuMode"]:checked').value;
  const seq = AppState.sequences[mode] || [];
  const labels = AppState.adapter.getLabels(mode);
  const input = document.getElementById('patInput').value.trim();
  const resultDiv = document.getElementById('patResult');

  let pattern;

  if (mode === '组合') {
    const t = input.replace(/[\s，,]/g, '');
    pattern = [];
    for (let i = 0; i < t.length; i += 2) {
      pattern.push(t.slice(i, i + 2));
    }
    if (pattern.some(x => !labels.includes(x))) pattern = null;
  } else {
    const allowed = labels.join('');
    const t = input.replace(/[\s，,]/g, '');
    pattern = t.split('').filter(c => allowed.includes(c));
    if (!t || pattern.length === 0) pattern = null;
  }

  if (!pattern || pattern.length === 0) {
    resultDiv.innerHTML = '<div class="pat-result-error">形态格式不正确</div>';
    return;
  }

  const result = luzhuAfterPattern(seq, pattern);

  let html = '<div class="pat-result-success">';
  html += '形态 ' + pattern.join(' → ') + '｜样本 ' + result.total;

  if (result.total > 0) {
    const sorted = labels.map(lb => ({ label: lb, count: result[lb] || 0, pct: result[lb + '%'] || 0 }))
      .sort((a, b) => b.pct - a.pct);

    html += '<div class="pat-stats">';
    for (const s of sorted) {
      html += '<div class="pat-stat-item">';
      html += '<div class="val">' + s.pct + '%</div>';
      html += '<div class="label">下期「' + s.label + '」 ' + s.count + '次</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  resultDiv.innerHTML = html;
}

// ==================== 模型实验室 ====================

function updateLabPage() {
  const activeTab = document.querySelector('.lab-tab.active');
  if (activeTab) {
    runLabEvaluation(activeTab.dataset.cat);
  } else {
    runLabEvaluation('大小');
  }
}

function runLabEvaluation(category) {
  const seq = AppState.sequences[category] || [];
  const minHistory = parseInt(document.getElementById('minHist').value);
  const tbody = document.getElementById('labTableBody');
  const bestDiv = document.getElementById('labBest');

  if (seq.length < minHistory + 10) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-text">历史样本不足，需要至少' + (minHistory + 10) + '期</td></tr>';
    bestDiv.innerHTML = '';
    return;
  }

  const labels = AppState.adapter.getLabels(category);

  try {
    const rows = evaluateModels(seq, labels, minHistory);

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-text">计算中...</td></tr>';
      return;
    }

    let html = '';
    for (const r of rows) {
      html += '<tr>';
      html += '<td style="font-weight:700;">' + r['模型'] + '</td>';
      html += '<td>' + r['长期样本'] + '</td>';
      html += '<td style="color:#c41e3a;font-weight:700;">' + r['长期准确率'].toFixed(2) + '%</td>';
      html += '<td>' + (r['长期显著'] ? '<span style="color:green;">✓</span>' : '<span style="color:#999;">✗</span>') + '</td>';
      html += '<td style="font-family:monospace;">' + r['长期p值'].toFixed(4) + '</td>';
      html += '<td style="font-weight:700;color:' + (r['综合分'] > 0 ? '#15803d' : '#b91c1c') + ';">' + (r['综合分'] > 0 ? '+' : '') + r['综合分'].toFixed(2) + '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;

    const best = rows.reduce((a, b) => a['综合分'] > b['综合分'] ? a : b);
    const baseline = 100 / labels.length;

    if (best['长期显著'] && best['长期优势'] > 0) {
      bestDiv.className = 'lab-best success';
      bestDiv.innerHTML = '✓ 当前综合表现最佳：<b>' + best['模型'] + '</b>（p=' + best['长期p值'].toFixed(4) + '，显著）';
    } else {
      bestDiv.className = 'lab-best warning';
      bestDiv.innerHTML = '⚠ 当前没有经校正后显著优于随机的稳定模型（最佳p=' + best['长期p值'].toFixed(4) + '）';
    }
  } catch (e) {
    console.error('Lab eval error:', e);
    tbody.innerHTML = '<tr><td colspan="6" style="color:#b91c1c;">计算出错：' + e.message + '</td></tr>';
  }
}

// ==================== 历史记录 ====================

function updateHistoryPage() {
  if (!AppState.adapter) return;

  const cat = document.getElementById('filterCat').value;
  const result = document.getElementById('filterResult').value;
  const window = parseInt(document.getElementById('filterWindow').value);

  // 更新类别选项
  const categories = AppState.adapter.defaultCategories;
  // 加上位置预测类别
  const posConfig = AppState.adapter.positionConfig;
  const allCats = [...categories];
  if (posConfig && posConfig.enabled) {
    for (const pos of posConfig.positions) {
      allCats.push(pos.name);
    }
  }

  const catSelect = document.getElementById('filterCat');
  const currentVal = catSelect.value;
  catSelect.innerHTML = '<option value="全部">全部类型</option>';
  for (const c of allCats) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catSelect.appendChild(opt);
  }
  if (cat && (cat === '全部' || allCats.includes(cat))) {
    catSelect.value = cat;
  }

  // 加载记录
  let records = Storage.loadPredictions(AppState.adapter.predKey, window,
    cat === '全部' ? null : cat,
    result === '全部' ? null : result
  );

  // 统计
  const settled = records.filter(r => r.result === '对' || r.result === '错');
  const ok = settled.filter(r => r.result === '对').length;
  const bad = settled.length - ok;
  const rate = settled.length > 0 ? ok / settled.length * 100 : 0;
  const base = (cat === '组合' || (cat !== '大小' && cat !== '单双' && cat !== '全部' && !categories.includes(cat))) ? 30 : 50;

  document.getElementById('hsTotal').textContent = records.length;
  document.getElementById('hsSettled').textContent = settled.length;
  document.getElementById('hsOk').textContent = ok;
  document.getElementById('hsBad').textContent = bad;
  document.getElementById('hsRate').textContent = rate.toFixed(1) + '%';
  document.getElementById('hsAdv').textContent = (rate - base > 0 ? '+' : '') + (rate - base).toFixed(1) + 'pt';

  // 列表
  const list = document.getElementById('historyList');
  if (records.length === 0) {
    list.innerHTML = '<div class="empty-text">暂无预测记录。新期出现后会自动保存并结算。</div>';
    return;
  }

  let html = '';
  for (const r of records.slice(0, 100)) {
    const resultClass = r.result === '对' ? 'ok' : (r.result === '错' ? 'bad' : 'pending');
    const resultText = { '对': '✅ 对', '错': '❌ 错', '待开': '⏳ 待开' }[r.result] || r.result;

    html += '<div class="history-item">';
    html += '<div class="hist-header">';
    html += '<span class="hist-issue">第' + r.issue + '期 · ' + r.category + '</span>';
    html += '<span class="hist-result ' + resultClass + '">' + resultText + '</span>';
    html += '</div>';
    html += '<div class="hist-detail">';
    html += '<span>倾向：<b>' + r.lean + '</b>（' + r.pct + '%）</span>';
    html += '<span>样本：' + r.sample + '</span>';
    html += '</div>';
    if (r.top3 && r.top3.length > 0) {
      html += '<div class="hist-detail" style="margin-top:2px;">';
      html += '<span>Top3：' + r.top3.join(', ') + '</span>';
      html += '</div>';
    }
    html += '<div class="hist-detail">';
    html += '<span>模型：' + (r.modelName || '-') + '</span>';
    html += '<span>实际：' + (r.actual || '-') + '</span>';
    html += '</div>';
    html += '</div>';
  }

  list.innerHTML = html;
}

// ==================== 批量回填 ====================

// v4 新增：sleep 工具函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// v4 新增：批量回填历史数据
async function startBackfill() {
  if (!AppState.adapter || AppState.backfilling) return;

  const daysStr = prompt('请输入回填天数（建议不超过 365 天）：', '30');
  if (!daysStr) return;

  const days = parseInt(daysStr);
  if (isNaN(days) || days <= 0) {
    alert('请输入有效的天数');
    return;
  }
  if (days > 730) {
    if (!confirm('回填' + days + '天数据可能需要较长时间，确定继续吗？')) return;
  }

  AppState.backfilling = true;
  AppState.backfillAbort = false;

  const btn = document.getElementById('backfillBtn');
  if (btn) {
    btn.textContent = '回填中...';
    btn.disabled = true;
  }

  // 显示进度
  const progressEl = document.getElementById('backfillProgress');
  if (progressEl) {
    progressEl.style.display = 'block';
    progressEl.innerHTML = '<div class="backfill-info">准备回填数据...</div>';
  }

  try {
    const lotCode = AppState.currentConfig.code;
    let totalInserted = 0;
    let totalSkipped = 0;

    // 分批回填，每次 30 天，避免一次请求过多
    const batchSize = 30;
    const batches = Math.ceil(days / batchSize);

    for (let i = 0; i < batches; i++) {
      if (AppState.backfillAbort) {
        if (progressEl) {
          progressEl.innerHTML += '<div class="backfill-info">✋ 已中止回填</div>';
        }
        break;
      }

      const batchDays = Math.min(batchSize, days - i * batchSize);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - i * batchSize);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - batchDays + 1);

      if (progressEl) {
        progressEl.innerHTML +=
          '<div class="backfill-info">第 ' + (i + 1) + '/' + batches +
          ' 批：' + formatDate(startDate) + ' ~ ' + formatDate(endDate) +
          '（' + batchDays + ' 天）...</div>';
      }

      try {
        const result = await backfillDateRange(startDate, endDate);
        totalInserted += result.inserted;
        totalSkipped += result.skipped;

        if (progressEl) {
          progressEl.innerHTML +=
            '<div class="backfill-info backfill-success">✓ 新增 ' + result.inserted +
            ' 条，已存在 ' + result.skipped + ' 条</div>';
        }
      } catch (e) {
        if (progressEl) {
          progressEl.innerHTML +=
            '<div class="backfill-info backfill-error">✗ 第 ' + (i + 1) +
            ' 批失败：' + e.message + '</div>';
        }
      }

      // 批次间短暂休息，避免请求过快
      await sleep(500);
    }

    if (progressEl) {
      progressEl.innerHTML +=
        '<div class="backfill-info backfill-total"><b>回填完成</b>：共新增 ' + totalInserted +
        ' 条，跳过 ' + totalSkipped + ' 条</div>';
    }

    // 回填完成后重新加载数据
    if (totalInserted > 0) {
      await loadData();
    }

  } catch (e) {
    if (progressEl) {
      progressEl.innerHTML += '<div class="backfill-info backfill-error">回填失败：' + e.message + '</div>';
    }
  } finally {
    AppState.backfilling = false;
    if (btn) {
      btn.textContent = '开始回填';
      btn.disabled = false;
    }
  }
}

// v4 新增：回填指定日期范围的历史数据
async function backfillDateRange(startDate, endDate) {
  if (!AppState.adapter) return { inserted: 0, skipped: 0 };

  const lotCode = AppState.currentConfig.code;

  // 使用适配器的 fetchHistory 方法（不同适配器有不同实现）
  // Luck20Adapter 使用 API，PKSAdapter 可以生成数据
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  let rows = [];
  try {
    rows = await AppState.adapter.fetchHistory(days);
  } catch (e) {
    // 如果 API 失败，尝试按日期范围构造请求
    console.warn('fetchHistory failed, trying alternative:', e.message);
    return { inserted: 0, skipped: 0 };
  }

  if (!rows || rows.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  // 只保留日期范围内的
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  const filtered = rows.filter(r => {
    const t = String(r['开奖时间'] || '').slice(0, 10);
    return t >= startStr && t <= endStr;
  });

  // 写入数据库
  let inserted = 0;
  let skipped = 0;

  for (const row of filtered) {
    const issue = String(row['期号'] || '');
    if (!issue) continue;

    try {
      const exists = await CacheDB.getDrawByIssue(lotCode, issue);
      if (exists) {
        skipped++;
      } else {
        await CacheDB.addDrawHistory(lotCode, row);
        inserted++;
      }
    } catch (e) {
      skipped++;
    }
  }

  return { inserted, skipped };
}

// v4 新增：日期格式化
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// ==================== v5.0 新增：算法选择器 ====================

// v5.0 新增：从各算法结果计算一致性
function computeModelAgreementFromAlgos(algoResults, labels) {
  const algos = Object.values(algoResults).filter(r => r && r.lean);
  if (algos.length <= 1) return 1.0;

  const leanCount = {};
  for (const lb of labels) leanCount[lb] = 0;

  for (const r of algos) {
    if (r.lean && leanCount[r.lean] !== undefined) {
      leanCount[r.lean]++;
    }
  }

  const maxCount = Math.max(...Object.values(leanCount));
  return maxCount / algos.length;
}

function initAlgoSelector() {
  const selector = document.getElementById('algoSelector');
  if (!selector) return;

  const tabs = selector.querySelectorAll('.algo-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const algo = tab.dataset.algo;
      AppState.currentAlgo = algo;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // 切换对比面板显示
      const comparePanel = document.getElementById('algoComparePanel');
      if (algo === 'compare') {
        comparePanel.style.display = 'block';
      } else {
        comparePanel.style.display = 'none';
      }

      // v5.2 新增：融合设置面板显示/隐藏
      const fusionPanel = document.getElementById('fusionSettingsPanel');
      if (fusionPanel) {
        if (algo === 'fusion') {
          fusionPanel.style.display = 'block';
          initFusionSettingsPanel(); // 确保面板已初始化
        } else {
          fusionPanel.style.display = 'none';
        }
      }

      // 重新生成预测
      generatePredictions();
    });
  });

  // 默认选中经验学习
  const defaultTab = selector.querySelector('[data-algo="experience"]');
  if (defaultTab) defaultTab.classList.add('active');
}

// ==================== v5.0 新增：生成多算法预测 ====================

function generateAllAlgoPredictions(seq, labels, category) {
  const results = {};
  const lotCode = AppState.currentConfig.code;

  // 算法一：形态匹配（历史对照）
  try {
    const patternPred = PredictorFactory.get('pattern');
    const pResult = patternPred.predict(seq, labels, { lotCode, category });
    results.pattern = pResult;
  } catch (e) {
    console.warn('形态匹配算法失败:', e);
    results.pattern = { final: {}, lean: '-', pct: 0, sample: 0, confidence: '低' };
  }

  // 算法二：经验学习（EWMA自适应）
  try {
    const expPred = PredictorFactory.get('experience');
    const ewmaMgr = AppState.ewmaMgr;
    const ewmaScores = ewmaMgr && ewmaMgr._scores && ewmaMgr._scores[lotCode]
      ? ewmaMgr._scores[lotCode][category] || {}
      : {};
    const eResult = expPred.predict(seq, labels, {
      lotCode,
      category,
      ewmaScores,
      modelCandidates: MODEL_CANDIDATES,
    });
    results.experience = eResult;
  } catch (e) {
    console.warn('经验学习算法失败:', e);
    results.experience = { final: {}, lean: '-', pct: 0, sample: 0, confidence: '低' };
  }

  // 算法三：手动标记
  try {
    const manualPred = PredictorFactory.get('manual');
    const mResult = manualPred.predict(seq, labels, { lotteryType: lotCode, category });
    results.manual = mResult;
  } catch (e) {
    console.warn('手动标记算法失败:', e);
    results.manual = { final: {}, lean: '-', pct: 0, sample: 0, confidence: '低' };
  }

  // v5.2 新增：算法四 - 智能融合
  try {
    const fusionPred = PredictorFactory.get('fusion');
    const fusionConfig = FusionConfig.load();
    const ewmaMgr = AppState.ewmaMgr;
    const ewmaScores = ewmaMgr && ewmaMgr._scores && ewmaMgr._scores[lotCode]
      ? ewmaMgr._scores[lotCode][category] || {}
      : {};
    const fResult = fusionPred.predict(seq, labels, {
      lotCode,
      category,
      fusionStrategy: fusionConfig.strategy,
      enabledModels: fusionConfig.enabledModels,
      ewmaScores,
      ewmaMgr,
    });
    results.fusion = fResult;
  } catch (e) {
    console.warn('智能融合算法失败:', e);
    results.fusion = { final: {}, lean: '-', pct: 0, sample: 0, confidence: '低', details: [], subPredictions: [], weights: [] };
  }

  return results;
}

// ==================== v5.0 新增：置信度横幅渲染 ====================

function renderConfidenceBanner(confidence) {
  const banner = document.getElementById('confidenceBanner');
  const levelEl = document.getElementById('confLevel');
  const textEl = document.getElementById('confText');

  if (!banner || !confidence) {
    if (banner) banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  banner.className = 'confidence-banner conf-' + confidence.level;
  levelEl.textContent = confidence.label;
  textEl.textContent = confidence.recommend;
}

// ==================== v5.0 新增：算法对比面板渲染 ====================

function renderAlgoComparison(algoResults, category) {
  const panel = document.getElementById('algoComparePanel');
  const grid = document.getElementById('compareGrid');
  if (!panel || !grid) return;

  const algoInfo = {
    experience: { name: '经验学习', icon: '🎯' },
    pattern: { name: '形态匹配', icon: '📊' },
    manual: { name: '手动标记', icon: '✍️' },
    fusion: { name: '智能融合', icon: '🔮' }, // v5.2 新增
  };

  let html = '';
  for (const [algo, info] of Object.entries(algoInfo)) {
    const result = algoResults[algo];
    if (!result) continue;

    const activeClass = AppState.currentAlgo === algo ? 'active' : '';
    const lean = result.lean || '-';
    const pct = result.pct ? (typeof result.pct === 'number' ? result.pct.toFixed(1) + '%' : result.pct) : '-';
    const conf = result.confidence ? result.confidence : '-';

    html += '<div class="compare-card ' + activeClass + '" data-algo="' + algo + '">';
    html += '<div class="compare-card-name">' + info.icon + ' ' + info.name + '</div>';
    html += '<div class="compare-card-lean">' + lean + '</div>';
    html += '<div class="compare-card-prob">' + pct + '</div>';
    html += '<span class="compare-card-conf">' + conf + '</span>';
    html += '</div>';
  }

  grid.innerHTML = html;

  // 绑定点击事件，点击切换主算法
  grid.querySelectorAll('.compare-card').forEach(card => {
    card.addEventListener('click', () => {
      const algo = card.dataset.algo;
      const selector = document.getElementById('algoSelector');
      const targetTab = selector.querySelector('[data-algo="' + algo + '"]');
      if (targetTab) targetTab.click();
    });
  });
}

// ==================== v5.2 新增：融合设置面板 ====================

let _fusionPanelInitialized = false;

function initFusionSettingsPanel() {
  if (_fusionPanelInitialized) return;
  _fusionPanelInitialized = true;

  const panel = document.getElementById('fusionSettingsPanel');
  if (!panel) return;

  const config = FusionConfig.load();

  // 1. 折叠/展开
  const header = document.getElementById('fusionSettingsToggle');
  if (header) {
    header.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });
  }

  // 2. 融合策略选择
  const strategyGrid = document.getElementById('fusionStrategyGrid');
  if (strategyGrid) {
    const strategyBtns = strategyGrid.querySelectorAll('.fusion-strategy-btn');
    strategyBtns.forEach(btn => {
      // 设置初始状态
      if (btn.dataset.strategy === config.strategy) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
      btn.addEventListener('click', () => {
        const strategy = btn.dataset.strategy;
        strategyBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        FusionConfig.update('strategy', strategy);
        // 重新生成预测
        generatePredictions();
      });
    });
  }

  // 3. 子模型列表渲染
  renderFusionModelList();

  // 4. 全选/全不选/智能推荐
  const selectAllBtn = document.getElementById('fusionSelectAll');
  const selectNoneBtn = document.getElementById('fusionSelectNone');
  const smartRecBtn = document.getElementById('fusionSmartRecommend');

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const allModels = getAdvancedModelList();
      const allIds = allModels.map(m => m.id);
      FusionConfig.update('enabledModels', allIds);
      renderFusionModelList();
      generatePredictions();
    });
  }

  if (selectNoneBtn) {
    selectNoneBtn.addEventListener('click', () => {
      FusionConfig.update('enabledModels', []);
      renderFusionModelList();
      generatePredictions();
    });
  }

  if (smartRecBtn) {
    smartRecBtn.addEventListener('click', () => {
      // 智能推荐：默认推荐4个核心模型
      const recommended = ['markov1', 'bayesian', 'weightedFreq', 'multiScale'];
      FusionConfig.update('enabledModels', recommended);
      renderFusionModelList();
      generatePredictions();
    });
  }
}

function renderFusionModelList() {
  const listEl = document.getElementById('fusionModelList');
  const countEl = document.getElementById('fusionModelCount');
  if (!listEl) return;

  const config = FusionConfig.load();
  const models = getAdvancedModelList();

  let html = '';
  for (const model of models) {
    const isSelected = config.enabledModels.includes(model.id);
    const selectedClass = isSelected ? 'selected' : '';
    html += '<div class="fusion-model-item ' + selectedClass + '" data-model-id="' + model.id + '">';
    html += '<div class="fusion-model-check">' + (isSelected ? '✓' : '') + '</div>';
    html += '<span class="fusion-model-icon">' + model.icon + '</span>';
    html += '<div class="fusion-model-info">';
    html += '<div class="fusion-model-name">' + model.name + '</div>';
    html += '<div class="fusion-model-desc">' + model.description + '</div>';
    html += '</div>';
    html += '<span class="fusion-model-category">' + model.category + '</span>';
    html += '</div>';
  }
  listEl.innerHTML = html;

  // 更新数量
  if (countEl) {
    countEl.textContent = config.enabledModels.length + '个模型';
  }

  // 绑定点击事件
  listEl.querySelectorAll('.fusion-model-item').forEach(item => {
    item.addEventListener('click', () => {
      const modelId = item.dataset.modelId;
      FusionConfig.toggleModel(modelId);
      renderFusionModelList();
      generatePredictions();
    });
  });
}

// 更新融合权重条形图（在预测生成后调用）
function updateFusionWeightBars() {
  const barsEl = document.getElementById('fusionWeightBars');
  if (!barsEl) return;
  if (AppState.currentAlgo !== 'fusion') return;

  const dxResults = AppState.algoPredictions && AppState.algoPredictions['dx'];
  const fusionResult = dxResults && dxResults['fusion'];
  if (!fusionResult || !fusionResult.subPredictions) return;

  const subPreds = fusionResult.subPredictions;
  const weights = fusionResult.weights || [];

  if (subPreds.length === 0) {
    barsEl.innerHTML = '<div style="font-size:12px;color:var(--text-light);text-align:center;padding:10px;">暂无选中的模型</div>';
    return;
  }

  let html = '';
  for (let i = 0; i < subPreds.length; i++) {
    const pred = subPreds[i];
    const w = weights[i] || 0;
    const wPct = Math.round(w * 100 * 10) / 10; // 百分比
    const name = pred.modelName || pred.name || '模型' + (i + 1);
    const shortName = name.length > 6 ? name.substring(0, 6) + '…' : name;

    html += '<div class="fusion-weight-item">';
    html += '<div class="fusion-weight-label" title="' + name + '">' + shortName + '</div>';
    html += '<div class="fusion-weight-bar-wrap">';
    html += '<div class="fusion-weight-bar" style="width:' + wPct + '%;"></div>';
    html += '</div>';
    html += '<div class="fusion-weight-value">' + wPct + '%</div>';
    html += '</div>';
  }
  barsEl.innerHTML = html;
}

// ==================== v5.0 新增：战绩页 ====================

function initStatsPage() {
  const backfillBtn = document.getElementById('btnBackfillStats');
  const resetBtn = document.getElementById('btnResetStats');

  if (backfillBtn) {
    backfillBtn.addEventListener('click', () => {
      if (!confirm('将根据历史预测记录批量回填战绩数据，是否继续？')) return;
      backfillStatsFromHistory();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('确定要重置所有战绩数据吗？此操作不可恢复。')) return;
      const lotCode = AppState.currentConfig.code;
      PredictionStats.reset(lotCode);
      updateStatsPage();
    });
  }

  // v5.1 新增：战绩页子标签切换
  const statsTabs = document.querySelectorAll('.stats-tabs .sub-tab');
  statsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.statsTab;
      statsTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.stats-subpage').forEach(p => p.style.display = 'none');
      const target = document.getElementById('stats' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
      if (target) target.style.display = 'block';

      // 切换到对应子标签时刷新数据
      if (tabName === 'history') {
        updateHistoryPage();
      } else if (tabName === 'draws') {
        updateDrawsList();
      }
    });
  });

  // v5.1 新增：开奖历史期数筛选
  const drawsWindow = document.getElementById('drawsWindow');
  if (drawsWindow) {
    drawsWindow.addEventListener('change', updateDrawsList);
  }
}

function updateStatsPage() {
  const lotCode = AppState.currentConfig.code;
  if (!lotCode) return;

  const stats = PredictionStats.getStats(lotCode);
  const summary = stats.summary || {};

  // 总览
  document.getElementById('overallRate').textContent =
    summary.total > 0 ? summary.rate.toFixed(1) + '%' : '--';
  document.getElementById('statsTotal').textContent = summary.total || 0;
  document.getElementById('statsCorrect').textContent = summary.correct || 0;
  document.getElementById('statsWrong').textContent = summary.wrong || 0;

  // 连对连错
  const currentStreak = stats.currentStreak || { type: '-', count: 0 };
  document.getElementById('statsCurrentStreak').textContent = currentStreak.count || 0;
  document.getElementById('statsCurrentType').textContent =
    currentStreak.type === '连对' ? '连对' :
    currentStreak.type === '连错' ? '连错' : '-';
  document.getElementById('statsMaxWin').textContent = stats.maxWinStreak || 0;
  document.getElementById('statsMaxLose').textContent = stats.maxLoseStreak || 0;

  // 更新最近连错数（用于谨慎预测）
  if (currentStreak.type === '连错') {
    AppState.lastStatsStreak = currentStreak.count || 0;
  } else {
    AppState.lastStatsStreak = 0;
  }

  // 分类命中率
  const catStats = stats.byCategory || {};
  const cats = [
    { key: '大小', rateId: 'rateDx', detailId: 'rateDxDetail' },
    { key: '单双', rateId: 'rateDs', detailId: 'rateDsDetail' },
    { key: '组合', rateId: 'rateZuhe', detailId: 'rateZuheDetail' },
  ];

  cats.forEach(cat => {
    const cs = catStats[cat.key];
    const rateEl = document.getElementById(cat.rateId);
    const detailEl = document.getElementById(cat.detailId);
    if (cs && cs.total > 0) {
      rateEl.textContent = cs.rate.toFixed(1) + '%';
      detailEl.textContent = cs.correct + '/' + cs.total;
    } else {
      rateEl.textContent = '--';
      detailEl.textContent = '0/0';
    }
  });

  // 置信度准确率
  const confStats = stats.byConfidence || {};
  const confLevels = [
    { key: 'strong', rateId: 'confStrongRate', countId: 'confStrongCount' },
    { key: 'high', rateId: 'confHighRate', countId: 'confHighCount' },
    { key: 'medium', rateId: 'confMediumRate', countId: 'confMediumCount' },
    { key: 'low', rateId: 'confLowRate', countId: 'confLowCount' },
  ];

  confLevels.forEach(level => {
    const cs = confStats[level.key];
    const rateEl = document.getElementById(level.rateId);
    const countEl = document.getElementById(level.countId);
    if (cs && cs.total > 0) {
      rateEl.textContent = cs.rate.toFixed(1) + '%';
      countEl.textContent = cs.total + '次';
    } else {
      rateEl.textContent = '--';
      countEl.textContent = '0次';
    }
  });

  // 最近走势
  const records = stats.records || [];
  const recent = records.slice(0, 10); // 最新的在前面
  const trendEl = document.getElementById('recentTrend');
  if (trendEl) {
    let trendHtml = '';
    recent.forEach(r => {
      const cls = r.result === '对' ? 'win' : r.result === '错' ? 'lose' : 'pending';
      const label = r.result === '对' ? '✓' : r.result === '错' ? '✗' : '?';
      trendHtml += '<div class="trend-dot ' + cls + '" title="第' + (r.issue || '') + '期">' + label + '</div>';
    });
    if (trendHtml === '') {
      trendHtml = '<div style="color:var(--text-light);font-size:12px;">暂无战绩数据</div>';
    }
    trendEl.innerHTML = trendHtml;
  }

  // v5.1 新增：分类卡片点击跳转到历史记录并筛选
  const catCards = document.querySelectorAll('#catRateGrid .cat-rate-card');
  const catMap = { 0: '大小', 1: '单双', 2: '组合' };
  catCards.forEach((card, idx) => {
    card.onclick = () => {
      const catName = catMap[idx];
      if (!catName) return;

      // 切换到历史记录子标签
      const statsTabs = document.querySelectorAll('.stats-tabs .sub-tab');
      statsTabs.forEach(t => t.classList.remove('active'));
      const historyTab = document.querySelector('.stats-tabs [data-stats-tab="history"]');
      if (historyTab) historyTab.classList.add('active');

      document.querySelectorAll('.stats-subpage').forEach(p => p.style.display = 'none');
      const historyPage = document.getElementById('statsHistory');
      if (historyPage) historyPage.style.display = 'block';

      // 设置分类筛选
      const catSelect = document.getElementById('filterCat');
      if (catSelect) {
        catSelect.value = catName;
        updateHistoryPage();
      }
    };
  });
}

// 从历史预测记录回填战绩
function backfillStatsFromHistory() {
  const lotCode = AppState.currentConfig.code;
  if (!lotCode) return;

  const history = Storage.loadPredictions(AppState.adapter.predKey, 1000);
  let count = 0;

  for (const record of history) {
    if (record.result === '对' || record.result === '错') {
      PredictionStats.addRecord(lotCode, {
        issue: record.issue,
        category: record.category,
        lean: record.lean,
        result: record.result,
        confidence: record.confidence || 'medium',
        time: record.time,
        modelName: record.modelName,
      });
      count++;
    }
  }

  alert('已回填 ' + count + ' 条战绩记录');
  updateStatsPage();
}

// ==================== v5.1 新增：开奖历史列表 ====================

function updateDrawsList() {
  const listEl = document.getElementById('drawsList');
  const rows = AppState.historyRows;
  if (!listEl || !rows || rows.length === 0) {
    if (listEl) listEl.innerHTML = '<div class="empty-text">暂无开奖数据</div>';
    return;
  }

  const windowSel = document.getElementById('drawsWindow');
  const limit = windowSel ? parseInt(windowSel.value) : 50;

  // 取最近 N 期（historyRows 是升序，最新的在最后）
  const recent = rows.slice(-limit).reverse();

  const adapter = AppState.adapter;
  const isLuck20 = adapter.config.type === 'luck20';
  const isPKS = adapter.config.type === 'pks';

  let html = '';
  for (const row of recent) {
    const issue = row['期号'] || '-';
    const time = row['开奖时间'] || '';
    const timeShort = time ? String(time).slice(5, 16) : '';

    let ballsHtml = '';
    if (isLuck20 && row['号码']) {
      const nums = row['号码'];
      ballsHtml = nums.map(n =>
        '<span class="draw-num-ball">' + String(n).padStart(2, '0') + '</span>'
      ).join('');
    } else if (isPKS) {
      // PK10 前5名
      const posKeys = adapter.positionKeys || ['号1', '号2', '号3', '号4', '号5'];
      const nums = posKeys.map(k => row[k]).filter(n => n !== undefined && n !== null);
      ballsHtml = nums.map(n =>
        '<span class="draw-num-ball">' + String(n).padStart(2, '0') + '</span>'
      ).join('');
    } else {
      // 通用：尝试从号码字段获取
      const numStr = row['开奖号码'] || row['号码'] || '';
      if (Array.isArray(numStr)) {
        ballsHtml = numStr.slice(0, 10).map(n =>
          '<span class="draw-num-ball">' + String(n).padStart(2, '0') + '</span>'
        ).join('');
      }
    }

    html += '<div class="draw-item">';
    html += '<span class="draw-issue">第' + issue + '期</span>';
    html += '<span class="draw-nums">' + ballsHtml + '</span>';
    html += '<span class="draw-time">' + timeShort + '</span>';
    html += '</div>';
  }

  if (html === '') {
    html = '<div class="empty-text">暂无开奖数据</div>';
  }

  listEl.innerHTML = html;
}

// ==================== v5.0 新增：时段分析 ====================

function updatePeriodAnalysis() {
  const sequences = AppState.sequences;
  const rows = AppState.historyRows;
  if (!rows || rows.length === 0) return;

  const adapter = AppState.adapter;
  const timeKey = adapter.timeKey || '开奖时间';
  const numKey = adapter.numberKey || '开奖号码';

  // 当前时段和星期
  const now = new Date();
  const currentHour = now.getHours();
  const currentWeekday = now.getDay();

  const periodInfo = PeriodAnalysis.PERIODS.find(p => currentHour >= p.start && currentHour < p.end);
  const weekdayName = PeriodAnalysis.WEEKDAYS[currentWeekday];

  document.getElementById('currentPeriodName').textContent = periodInfo ? periodInfo.name : '-';
  document.getElementById('currentWeekdayName').textContent = weekdayName;

  // 大小时段分布
  const dxLabels = adapter.getLabels('大小');
  const dxPeriodData = PeriodAnalysis.analyzeByPeriod(rows,
    (row) => adapter.parseNumber(row[numKey]) >= (adapter.bigThreshold || 5) ? dxLabels[0] : dxLabels[1],
    (row) => row[timeKey],
    dxLabels
  );

  renderPeriodGrid('periodDxGrid', dxPeriodData, dxLabels, periodInfo ? periodInfo.key : null, 'big', 'small');

  // 单双时段分布
  const dsLabels = adapter.getLabels('单双');
  const dsPeriodData = PeriodAnalysis.analyzeByPeriod(rows,
    (row) => adapter.parseNumber(row[numKey]) % 2 === 1 ? dsLabels[0] : dsLabels[1],
    (row) => row[timeKey],
    dsLabels
  );

  renderPeriodGrid('periodDsGrid', dsPeriodData, dsLabels, periodInfo ? periodInfo.key : null, 'odd', 'even');

  // 星期分布
  const weekdayData = PeriodAnalysis.analyzeByWeekday(rows,
    (row) => adapter.parseNumber(row[numKey]) >= (adapter.bigThreshold || 5) ? dxLabels[0] : dxLabels[1],
    (row) => row[timeKey],
    dxLabels
  );

  renderWeekdayGrid('weekdayGrid', weekdayData, currentWeekday);
}

function renderPeriodGrid(gridId, periodData, labels, activeKey, firstCls, secondCls) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  // 转换为数组
  const periods = PeriodAnalysis.PERIODS.map(p => ({
    key: p.key,
    name: p.name,
    ...periodData[p.key]
  }));

  let html = '';
  periods.forEach(p => {
    const active = p.key === activeKey ? 'active' : '';
    const firstPct = p.pcts ? (p.pcts[labels[0]] || 0) : 0;
    const secondPct = p.pcts ? (p.pcts[labels[1]] || 0) : 0;
    const count = p.total || 0;

    html += '<div class="period-card ' + active + '">';
    html += '<div class="pc-header">';
    html += '<span class="pc-name">' + p.name + '</span>';
    html += '<span class="pc-count">' + count + '期</span>';
    html += '</div>';
    html += '<div class="pc-bars">';
    html += '<div class="pc-bar ' + firstCls + '" style="flex:' + firstPct + ';">' + firstPct.toFixed(0) + '%</div>';
    html += '<div class="pc-bar ' + secondCls + '" style="flex:' + secondPct + ';">' + secondPct.toFixed(0) + '%</div>';
    html += '</div>';
    html += '</div>';
  });

  grid.innerHTML = html;
}

function renderWeekdayGrid(gridId, weekdayData, activeDay) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  const weekdays = PeriodAnalysis.WEEKDAYS.map((name, idx) => ({
    idx,
    name,
    ...weekdayData[name]
  }));

  let html = '';
  weekdays.forEach(w => {
    const active = w.idx === activeDay ? 'active' : '';
    const pcts = w.pcts || {};
    const entries = Object.entries(pcts).sort((a, b) => b[1] - a[1]);
    const topLabel = entries[0] ? entries[0][0] : '-';
    const topPct = entries[0] ? entries[0][1] : 0;
    const count = w.total || 0;

    html += '<div class="weekday-card ' + active + '">';
    html += '<div class="wd-name">' + w.name + '</div>';
    html += '<div class="wd-val">' + topLabel + '</div>';
    html += '<div class="wd-count">' + topPct.toFixed(0) + '%</div>';
    html += '<div class="wd-count">' + count + '期</div>';
    html += '</div>';
  });

  grid.innerHTML = html;
}

// ==================== v5.1 新增：手动标记管理 ====================

let _selectedMarkResult = null;

function initManualMarks() {
  const catSelect = document.getElementById('markCategory');
  const resultBtns = document.querySelectorAll('.mark-result-btns .mark-btn');
  const addBtn = document.getElementById('addMarkBtn');
  const clearBtn = document.getElementById('clearMarksBtn');

  if (catSelect) {
    catSelect.addEventListener('change', () => {
      updateMarkResultButtons();
      updateMarksList();
      updateCurrentPattern();
    });
  }

  if (resultBtns) {
    resultBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        resultBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _selectedMarkResult = btn.dataset.result;
      });
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const catSelect = document.getElementById('markCategory');
      const category = catSelect ? catSelect.value : '大小';
      const confSelect = document.getElementById('markConfidence');
      const confidence = confSelect ? parseInt(confSelect.value) : 3;

      if (!_selectedMarkResult) {
        alert('请先选择标记结果（大/小 或 单/双）');
        return;
      }

      const seq = AppState.sequences[category];
      if (!seq || seq.length < 3) {
        alert('数据不足，无法获取当前形态');
        return;
      }

      // 取最近5期形态
      const pattern = seq.slice(-5);

      const manualPred = PredictorFactory.get('manual');
      await manualPred.addMark(AppState.currentConfig.code, category, {
        pattern: pattern,
        result: _selectedMarkResult,
        confidence: confidence,
      });

      alert('标记添加成功！');
      _selectedMarkResult = null;
      document.querySelectorAll('.mark-result-btns .mark-btn').forEach(b => b.classList.remove('active'));
      updateMarksList();
      generatePredictions(); // 重新生成预测
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('确定要清空本分类的所有标记吗？')) return;
      const catSelect = document.getElementById('markCategory');
      const category = catSelect ? catSelect.value : '大小';
      const manualPred = PredictorFactory.get('manual');
      await manualPred.saveMarks(AppState.currentConfig.code, category, []);
      updateMarksList();
      generatePredictions();
    });
  }
}

function updateMarkResultButtons() {
  const catSelect = document.getElementById('markCategory');
  const category = catSelect ? catSelect.value : '大小';
  const btnContainer = document.getElementById('markResultBtns');
  if (!btnContainer) return;

  const labels = AppState.adapter ? AppState.adapter.getLabels(category) : ['大', '小'];
  btnContainer.innerHTML = labels.map(l =>
    '<button class="mark-btn" data-result="' + l + '">' + l + '</button>'
  ).join('');

  // 重新绑定事件
  btnContainer.querySelectorAll('.mark-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btnContainer.querySelectorAll('.mark-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _selectedMarkResult = btn.dataset.result;
    });
  });

  _selectedMarkResult = null;
}

function updateCurrentPattern() {
  const catSelect = document.getElementById('markCategory');
  const category = catSelect ? catSelect.value : '大小';
  const seq = AppState.sequences[category];
  const el = document.getElementById('currentPattern');
  if (!el) return;

  if (seq && seq.length > 0) {
    const pattern = seq.slice(-5);
    el.textContent = pattern.join(' · ');
  } else {
    el.textContent = '--';
  }
}

function updateMarksList() {
  const catSelect = document.getElementById('markCategory');
  const category = catSelect ? catSelect.value : '大小';
  const listEl = document.getElementById('marksList');
  const countEl = document.getElementById('markCount');
  if (!listEl) return;

  const manualPred = PredictorFactory.get('manual');
  const marks = manualPred._marks[AppState.currentConfig.code]?.[category] || [];

  if (countEl) countEl.textContent = marks.length + ' 条';

  if (marks.length === 0) {
    listEl.innerHTML = '<div class="empty-text">暂无标记</div>';
    return;
  }

  let html = '';
  marks.slice(0, 20).forEach((m, idx) => {
    const stars = '★'.repeat(m.confidence || 3) + '☆'.repeat(5 - (m.confidence || 3));
    const patternStr = m.pattern ? m.pattern.join('') : '-';
    html += '<div class="mark-item">';
    html += '<span class="mark-pattern">' + patternStr + '</span>';
    html += '<span class="mark-result">' + m.result + '</span>';
    html += '<span class="mark-conf">' + stars + '</span>';
    html += '<span class="mark-delete" data-idx="' + idx + '" title="删除">✕</span>';
    html += '</div>';
  });

  if (marks.length > 20) {
    html += '<div style="text-align:center;color:var(--text-light);font-size:11px;">共 ' + marks.length + ' 条，仅显示最近20条</div>';
  }

  listEl.innerHTML = html;

  // 绑定删除事件
  listEl.querySelectorAll('.mark-delete').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.dataset.idx);
      if (isNaN(idx)) return;
      if (!confirm('确定删除这条标记吗？')) return;
      const allMarks = [...marks];
      allMarks.splice(idx, 1);
      await manualPred.saveMarks(AppState.currentConfig.code, category, allMarks);
      updateMarksList();
      generatePredictions();
    });
  });
}

// ==================== 启动 ====================

document.addEventListener('DOMContentLoaded', init);
