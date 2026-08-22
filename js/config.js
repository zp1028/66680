// 配置管理
const Settings = {
  apiBase: 'https://api.api16868.com',
  apiBaseAlt: 'https://api.api68.com',
  apiTimeoutConnect: 5000,
  apiTimeoutRead: 10000,
  apiRetries: 2,
  circuitFailureThreshold: 5,
  circuitRecoveryTimeout: 30000,
  backtestMinHistory: 40,
  backtestRecentLimitBase: 150,
  backtestLongMinSamples: 80,
  predictionMinSamples: 8,
  predictionAlpha: 1.0,
  cacheTtlLatest: 20000,
  cacheTtlHistory: 90000,
  cacheTtlModel: 60000,
  cacheTtlPrediction: 30000,
  significanceAlpha: 0.05,
  bonferroniCorrection: true,

  // ===== v4 优化新增 =====
  // 预测窗口期（期）：预测只使用最近 N 期数据，而非全部历史
  // 设为 0 表示使用全部数据（旧行为）
  // 值越小越灵敏（变化快），值越大越稳定（变化慢）
  predictionWindow: 100,
  // 组合预测专用：形态最小样本数（低于普通类别的 8，因为 4 标签样本稀疏）
  zuheMinSamples: 3,
  // 组合预测：形态模型使用的长度（以短形态为主，提升样本密度）
  zuhePatternLengths: [2, 3],
  // 组合预测：频率模型窗口（更短，更快反映趋势）
  zuheFreqWindows: [10, 20],
  // 组合预测：超短窗口频率（捕捉冷热突变）
  zuheUltraShortWindows: [5, 8],
  // 是否启用和值区间+组合 交叉特征
  zuheCrossFeature: true,
  // EWMA 学习率（越大越敏感，变化越快；越小越平滑）
  // 0.3 = 约5期见效，0.15 = 约10期见效，0.05 = 约30期见效
  ewmaAlpha: 0.25,
  // EWMA 是否启用（关闭则退回回测选择模型）
  ewmaEnabled: true,
  // EWMA 权重锐度：评分差异被放大的倍数（越大权重差距越明显）
  ewmaWeightTemperature: 0.08,
  // 位置预测号码数量（1~10）
  positionTopN: 3,
  // 组合预测 TopN
  zuheTopN: 3,
  // 是否启用"冷热趋势"增强（最近10期频率权重加倍）
  trendBoostEnabled: true,
  // ===== v4.2 新增：灵敏度控制 =====
  // 灵敏度模式：stable(稳定) / balanced(平衡) / aggressive(灵敏)
  // 灵敏模式下预测变化更快更明显，稳定模式下更平滑
  sensitivityMode: 'balanced',
  // 动量加权强度（0~1）：利用最近N期预测对错趋势放大权重差异
  // 值越大，近期表现好的模型权重越高，预测变化越明显
  momentumStrength: 0.5,
  // 动量窗口（期）：计算动量使用的最近期数
  momentumWindow: 10,
  // 反同质化强度（0~1）：降低预测相似模型的权重，增加多样性
  // 值越大，不同观点的模型权重越高，预测变化越明显
  antiHerdStrength: 0.3,
  // 连续相同衰减（0~1）：当预测连续N期相同时，自动降低该倾向的权重
  // 防止预测长期不变，值越大衰减越明显
  streakDecayEnabled: true,
  streakDecayRate: 0.15,
  streakDecayMaxPeriods: 5,
  // 超短窗口增强倍率（灵敏模式下生效）
  ultraShortBoost: 2.0,
  // 批量回填最大天数
  maxBackfillDays: 90,
  // 分析最大期数（频率/和值）
  maxAnalysisPeriods: 1000,
  // 和值分析最大期数
  maxSumAnalysisPeriods: 500,
};

// 彩种目录
const LOTTERY_CATALOG = [
  { key: '10037', name: '极速飞艇', type: 'pks', code: 10037 },
  { key: '10035', name: '极速赛车', type: 'pks', code: 10035 },
  { key: '10012', name: '幸运飞艇', type: 'pks', code: 10012 },
  { key: '10058', name: 'PK拾(10058)', type: 'pks', code: 10058 },
  { key: '10057', name: '澳洲幸运10', type: 'pks', code: 10057 },
  { key: '10054', name: '极速快乐8', type: 'luck20', code: 10054 },
  { key: '10047', name: '幸运20(10047)', type: 'luck20', code: 10047 },
];

// 模型候选列表（v4 扩展：增加短周期模型，提高 EWMA 自适应的多样性）
const MODEL_CANDIDATES = [
  { name: '2期形态', type: 'fixed', length: 2, window: 0 },
  { name: '3期形态', type: 'fixed', length: 3, window: 0 },
  { name: '4期形态', type: 'fixed', length: 4, window: 0 },
  { name: '5期形态', type: 'fixed', length: 5, window: 0 },
  { name: '6期形态', type: 'fixed', length: 6, window: 0 },
  { name: '10期频率', type: 'frequency', length: 0, window: 10 },
  { name: '20期频率', type: 'frequency', length: 0, window: 20 },
  { name: '30期频率', type: 'frequency', length: 0, window: 30 },
  { name: '50期频率', type: 'frequency', length: 0, window: 50 },
  { name: '自适应集成', type: 'ensemble', length: 0, window: 0 },
];

// 组合预测专用模型列表
const ZUHE_MODEL_CANDIDATES = [
  { name: '2期形态', type: 'fixed', length: 2, window: 0 },
  { name: '3期形态', type: 'fixed', length: 3, window: 0 },
  { name: '10期频率', type: 'frequency', length: 0, window: 10 },
  { name: '15期频率', type: 'frequency', length: 0, window: 15 },
  { name: '5期超短', type: 'frequency', length: 0, window: 5 },
  { name: '10期超短', type: 'frequency', length: 0, window: 10 },
  { name: '和值交叉', type: 'cross', length: 2, window: 0 },
];

const POS_COLS = ['冠军', '亚军', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'];

// 用户偏好设置（可在设置页调整，保存到 localStorage）
const UserPrefs = {
  _key: 'cai31_user_prefs',

  defaults: {
    predictionWindow: 100,
    positionTopN: 3,
    zuheTopN: 3,
    ewmaEnabled: true,
    zuheCrossFeature: true,
    ewmaAlpha: 0.25,
    ewmaWeightTemperature: 0.08,
    trendBoostEnabled: true,
    sensitivityMode: 'balanced',
    momentumStrength: 0.5,
    antiHerdStrength: 0.3,
    streakDecayEnabled: true,
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) {
        const data = JSON.parse(raw);
        return { ...this.defaults, ...data };
      }
    } catch (e) {
      console.warn('加载用户偏好失败:', e);
    }
    return { ...this.defaults };
  },

  save(prefs) {
    try {
      localStorage.setItem(this._key, JSON.stringify(prefs));
      // 同步到 Settings
      Object.assign(Settings, prefs);
    } catch (e) {
      console.warn('保存用户偏好失败:', e);
    }
  },

  applyToSettings() {
    const prefs = this.load();
    Object.assign(Settings, prefs);
    return prefs;
  },

  // v4 新增：更新单个偏好项
  update(key, value) {
    const prefs = this.load();
    prefs[key] = value;
    this.save(prefs);
  },
};
