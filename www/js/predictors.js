// v5.0 预测算法策略模式
// 三种算法实现统一接口，可自由切换和对比

// ==================== 算法枚举 ====================
const PREDICTOR_TYPES = {
  PATTERN: 'pattern',       // 算法一：历史预测对照（形态匹配）
  EXPERIENCE: 'experience', // 算法二：历史对错经验（EWMA自适应）
  MANUAL: 'manual',         // 算法三：手动标记概率
  FUSION: 'fusion',         // 算法四：智能融合引擎（v5.2新增）
};

// ==================== 算法元信息 ====================
const PREDICTOR_INFO = {
  [PREDICTOR_TYPES.PATTERN]: {
    name: '历史对照模式',
    shortName: '形态匹配',
    icon: '📊',
    description: '查找历史相同形态，统计后续结果分布',
    type: 'auto',
    color: '#4f46e5',
  },
  [PREDICTOR_TYPES.EXPERIENCE]: {
    name: '经验学习模式',
    shortName: '经验学习',
    icon: '🎯',
    description: '多模型集成，根据历史对错动态加权',
    type: 'auto',
    color: '#06b6d4',
  },
  [PREDICTOR_TYPES.MANUAL]: {
    name: '手动标记模式',
    shortName: '手动标记',
    icon: '✍️',
    description: '以你的标记数据为预测依据',
    type: 'manual',
    color: '#f59e0b',
  },
  // v5.2 新增：智能融合
  [PREDICTOR_TYPES.FUSION]: {
    name: '智能融合模式',
    shortName: '智能融合',
    icon: '🔮',
    description: '融合多算法智能加权，综合决策',
    type: 'auto',
    color: '#8b5cf6',
  },
};

// ==================== 算法一：历史预测对照（形态匹配） ====================

class PatternPredictor {
  constructor() {
    this.type = PREDICTOR_TYPES.PATTERN;
    this.info = PREDICTOR_INFO[PREDICTOR_TYPES.PATTERN];
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 3) {
      return this._emptyResult(labels);
    }

    const wSeq = getWindowedSeq(seq);
    const patternLengths = [2, 3, 4, 5];
    const models = [];

    for (const L of patternLengths) {
      const m = singlePatternModel(wSeq, labels, L, Settings.predictionMinSamples);
      if (m) {
        m.modelName = `${L}期形态`;
        // 时间衰减：近期匹配样本权重更高
        m.weight = this._weightWithTimeDecay(m, L);
        models.push(m);
      }
    }

    if (models.length === 0) {
      return this._emptyResult(labels);
    }

    // 按样本量加权融合
    const result = this._weightedFusion(models, labels);
    result.modelName = '形态匹配';
    result.predictorType = this.type;
    result.details = models.map(m => ({
      name: m.modelName,
      lean: m.lean,
      pct: m.pct,
      sample: m.sample,
      weight: Math.round((m.weight || 0) * 100) / 100,
    }));
    // v5.4 新增：p 值（按样本量加权融合各子模型p值）
    result.pValue = this._fusePValues(models);

    return result;
  }

  _weightWithTimeDecay(model, length) {
    const baseWeight = model.weight || 1;
    // 短形态样本多，长形态更精准，做平衡
    const lengthFactor = { 2: 0.8, 3: 1.0, 4: 1.1, 5: 1.15 }[length] || 1;
    return baseWeight * lengthFactor;
  }

  _weightedFusion(models, labels) {
    const scores = {};
    for (const lb of labels) scores[lb] = 0;
    let totalW = 0;

    for (const m of models) {
      const w = m.weight || 1;
      totalW += w;
      for (const lb of labels) {
        scores[lb] += (m.final[lb] || 0) * w;
      }
    }

    const final = {};
    for (const lb of labels) {
      final[lb] = totalW > 0 ? scores[lb] / totalW : 100 / labels.length;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const baseline = 100 / labels.length;
    const topPct = sorted[0][1];

    let confidence;
    if (Math.abs(topPct - baseline) < 3) confidence = '低';
    else if (Math.abs(topPct - baseline) < 7) confidence = '中';
    else confidence = '高';

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: models.reduce((s, m) => s + (m.sample || 0), 0) / models.length,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
    };
  }

  // v5.4 新增：融合多个模型的 p 值（Fisher 方法）
  _fusePValues(models) {
    if (!models || models.length === 0) return 1.0;
    // Fisher's method: -2 * sum(ln(p)) ~ chi-squared(2k)
    // 简化：按权重加权的几何平均
    let totalW = 0;
    let sumLogP = 0;
    for (const m of models) {
      const w = m.weight || 1;
      const p = m.pValue !== undefined ? m.pValue : 1.0;
      const pClamped = Math.max(p, 1e-10);
      totalW += w;
      sumLogP += w * Math.log(pClamped);
    }
    if (totalW <= 0) return 1.0;
    const fusedLogP = sumLogP / totalW;
    return Math.exp(fusedLogP);
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: '形态匹配',
      predictorType: this.type,
      details: [],
    };
  }
}

// ==================== 算法二：历史对错经验（EWMA自适应） ====================

class ExperiencePredictor {
  constructor() {
    this.type = PREDICTOR_TYPES.EXPERIENCE;
    this.info = PREDICTOR_INFO[PREDICTOR_TYPES.EXPERIENCE];
  }

  predict(seq, labels, options = {}) {
    const { ewmaScores = null, modelCandidates = null } = options;

    if (!seq || seq.length < 3) {
      return this._emptyResult(labels);
    }

    const candidates = modelCandidates || MODEL_CANDIDATES;
    const sensParams = getSensitivityParams();
    const wSeq = getWindowedSeq(seq, sensParams.predictionWindow);
    const models = [];

    for (const cand of candidates) {
      let m = null;
      try {
        if (cand.type === 'fixed') {
          m = singlePatternModel(wSeq, labels, cand.length, Settings.predictionMinSamples);
          if (m) m.modelName = cand.name;
        } else if (cand.type === 'frequency') {
          m = predictFrequency(wSeq, labels, cand.window);
          if (m) {
            m.modelName = cand.name;
            m.weight = Math.sqrt(m.sample) * 0.9;
          }
        } else if (cand.type === 'ensemble') {
          const dynWeights = computeDynamicWeights(wSeq, labels);
          m = adaptivePatternModel(wSeq, labels, [3, 4, 5, 6], null, dynWeights);
          if (m) m.modelName = cand.name;
        }
      } catch (e) { continue; }
      if (m) models.push(m);
    }

    if (models.length === 0) {
      return this._emptyResult(labels);
    }

    // EWMA 加权
    if (ewmaScores && Object.keys(ewmaScores).length > 0) {
      for (const m of models) {
        const score = ewmaScores[m.modelName];
        if (score !== undefined) {
          const temperature = sensParams.ewmaTemp;
          const multiplier = Math.exp((score - 0.5) / temperature);
          m.weight = (m.weight || 1) * multiplier;
        }
      }
    }

    // 冷热趋势增强
    if (Settings.trendBoostEnabled) {
      for (const m of models) {
        if (m.modelName && m.modelName.includes('期频率')) {
          const wMatch = m.modelName.match(/(\d+)期频率/);
          if (wMatch) {
            const w = parseInt(wMatch[1]);
            if (w <= 20) {
              const boost = w <= 10 ? 1.8 : 1.3;
              m.weight = (m.weight || 1) * boost;
            }
          }
        }
      }
    }

    // v4.2 优化机制
    applyUltraShortBoost(models, sensParams.ultraShortBoost);
    applyAntiHerdWeights(models, sensParams.antiHerdStrength);

    // 动量加权
    if (sensParams.momentumStrength > 0) {
      const momentum = computeModelMomentum(seq, labels, candidates, Settings.momentumWindow || 10);
      applyMomentumWeights(models, momentum, sensParams.momentumStrength);
    }

    // 加权融合
    let final = this._fuseModels(models, labels);

    // 连续相同衰减
    if (sensParams.streakDecayEnabled) {
      const streakInfo = computePredictionStreak(seq, labels, candidates, Settings.streakDecayMaxPeriods || 5);
      final = applyStreakDecay(final, labels, streakInfo, sensParams.streakDecayRate, Settings.streakDecayMaxPeriods || 5);
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;

    let effective = 0;
    let totalW = 0;
    for (const m of models) {
      const w = m.weight || 1;
      totalW += w;
      effective += (m.sample || 0) * w;
    }
    effective = totalW > 0 ? effective / totalW : 0;

    let confidence;
    if (effective < Settings.predictionMinSamples || Math.abs(topPct - baseline) < 3) confidence = '低';
    else if (effective < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
    else confidence = '高';

    // 计算经验分统计
    const experienceCount = ewmaScores ? Object.keys(ewmaScores).length : 0;
    const avgScore = experienceCount > 0
      ? Object.values(ewmaScores).reduce((a, b) => a + b, 0) / experienceCount
      : 0.5;

    // v5.4 新增：p 值（按权重加权融合各子模型p值）
    let pValue = 1.0;
    if (models.length > 0 && totalW > 0) {
      let sumLogP = 0;
      for (const m of models) {
        const w = m.weight || 1;
        const p = m.pValue !== undefined ? m.pValue : 1.0;
        sumLogP += w * Math.log(Math.max(p, 1e-10));
      }
      pValue = Math.exp(sumLogP / totalW);
    }

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: Math.round(effective * 10) / 10,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: '经验学习',
      predictorType: this.type,
      experienceCount,
      avgScore: Math.round(avgScore * 1000) / 10,
      pValue,
      details: models.map(m => ({
        name: m.modelName || '未知',
        lean: m.lean,
        pct: m.pct,
        sample: m.sample,
        weight: Math.round((m.weight || 0) * 100) / 100,
        ewmaScore: ewmaScores && ewmaScores[m.modelName] ? Math.round(ewmaScores[m.modelName] * 1000) / 10 : null,
      })),
    };
  }

  _fuseModels(models, labels) {
    const scores = {};
    for (const lb of labels) scores[lb] = 0;
    let totalW = 0;

    for (const m of models) {
      const w = m.weight || 1;
      totalW += w;
      for (const lb of labels) {
        scores[lb] += (m.final[lb] || 0) * w;
      }
    }

    const final = {};
    for (const lb of labels) {
      final[lb] = totalW > 0 ? scores[lb] / totalW : 100 / labels.length;
    }
    return final;
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: '经验学习',
      predictorType: this.type,
      experienceCount: 0,
      avgScore: 50,
      details: [],
    };
  }
}

// ==================== 算法三：手动标记概率 ====================

class ManualMarkPredictor {
  constructor() {
    this.type = PREDICTOR_TYPES.MANUAL;
    this.info = PREDICTOR_INFO[PREDICTOR_TYPES.MANUAL];
    this._marks = {}; // { lotteryType: { category: [marks] } }
  }

  // 加载标记数据
  async loadMarks(lotteryType, category) {
    try {
      const key = `marks_${lotteryType}_${category}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        if (!this._marks[lotteryType]) this._marks[lotteryType] = {};
        this._marks[lotteryType][category] = JSON.parse(raw);
        return this._marks[lotteryType][category];
      }
    } catch (e) {
      console.warn('[ManualMark] 加载标记失败:', e);
    }
    return [];
  }

  // 保存标记数据
  async saveMarks(lotteryType, category, marks) {
    try {
      const key = `marks_${lotteryType}_${category}`;
      localStorage.setItem(key, JSON.stringify(marks));
      if (!this._marks[lotteryType]) this._marks[lotteryType] = {};
      this._marks[lotteryType][category] = marks;
    } catch (e) {
      console.warn('[ManualMark] 保存标记失败:', e);
    }
  }

  // 添加标记
  async addMark(lotteryType, category, mark) {
    const marks = await this.loadMarks(lotteryType, category);
    mark.id = Date.now() + Math.random();
    mark.createdAt = new Date().toISOString();
    marks.unshift(mark);
    await this.saveMarks(lotteryType, category, marks);
    return mark;
  }

  // 删除标记
  async deleteMark(lotteryType, category, markId) {
    const marks = await this.loadMarks(lotteryType, category);
    const filtered = marks.filter(m => m.id !== markId);
    await this.saveMarks(lotteryType, category, filtered);
    return filtered;
  }

  predict(seq, labels, options = {}) {
    const { lotteryType = 'default', category = '大小' } = options;

    if (!seq || seq.length < 2) {
      return this._emptyResult(labels);
    }

    const marks = this._marks[lotteryType]?.[category] || [];

    if (marks.length === 0) {
      return {
        ...this._emptyResult(labels),
        markCount: 0,
        matchedCount: 0,
        warning: '暂无标记数据，请先添加标记',
      };
    }

    const wSeq = getWindowedSeq(seq);
    const currentPattern = wSeq.slice(-5); // 取最近5期形态

    // 查找匹配的标记
    const matched = [];
    for (const mark of marks) {
      if (!mark.pattern || mark.pattern.length === 0) continue;

      const similarity = this._calcSimilarity(currentPattern, mark.pattern);
      if (similarity >= 0.6) { // 60%以上相似度才算匹配
        matched.push({
          ...mark,
          similarity,
          finalWeight: similarity * (mark.confidence || 3) / 5,
        });
      }
    }

    if (matched.length === 0) {
      return {
        ...this._emptyResult(labels),
        markCount: marks.length,
        matchedCount: 0,
        warning: '未找到匹配的标记',
      };
    }

    // 按相似度和置信度加权统计结果分布
    const scores = {};
    for (const lb of labels) scores[lb] = 0;
    let totalW = 0;

    for (const m of matched) {
      const w = m.finalWeight;
      totalW += w;
      if (m.result && scores[m.result] !== undefined) {
        scores[m.result] += w;
      }
    }

    const final = {};
    for (const lb of labels) {
      final[lb] = totalW > 0 ? scores[lb] / totalW * 100 : 100 / labels.length;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;

    let confidence;
    if (matched.length < 2 || Math.abs(topPct - baseline) < 5) confidence = '低';
    else if (matched.length < 5 || Math.abs(topPct - baseline) < 10) confidence = '中';
    else confidence = '高';

    // v5.4 新增：p 值
    const pValue = computePValueFromDist(final, matched.length, labels);

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: matched.length,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: '手动标记',
      predictorType: this.type,
      markCount: marks.length,
      matchedCount: matched.length,
      pValue,
      matchedMarks: matched.slice(0, 10).map(m => ({
        pattern: m.pattern,
        result: m.result,
        similarity: Math.round(m.similarity * 100),
        confidence: m.confidence || 3,
      })),
      details: matched.slice(0, 8).map(m => ({
        name: `标记(${m.pattern.join('')}→${m.result})`,
        lean: m.result,
        pct: null,
        sample: 1,
        weight: Math.round(m.finalWeight * 100) / 100,
      })),
    };
  }

  // 计算两个形态序列的相似度（汉明距离变体，支持长度不同）
  _calcSimilarity(pattern1, pattern2) {
    const len1 = pattern1.length;
    const len2 = pattern2.length;
    const minLen = Math.min(len1, len2);

    if (minLen === 0) return 0;

    // 取末尾对齐比较
    const tail1 = pattern1.slice(-minLen);
    const tail2 = pattern2.slice(-minLen);

    let same = 0;
    for (let i = 0; i < minLen; i++) {
      if (tail1[i] === tail2[i]) same++;
    }

    // 基础相似度
    const baseSim = same / minLen;

    // 长度奖励：长度接近的奖励更高
    const lengthBonus = Math.min(len1, len2) / Math.max(len1, len2) * 0.2;

    return Math.min(1, baseSim * 0.8 + lengthBonus);
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: '手动标记',
      predictorType: this.type,
      markCount: 0,
      matchedCount: 0,
      details: [],
    };
  }
}

// ==================== 预测器工厂 ====================

const PredictorFactory = {
  _instances: {},

  get(type) {
    if (!this._instances[type]) {
      switch (type) {
        case PREDICTOR_TYPES.PATTERN:
          this._instances[type] = new PatternPredictor();
          break;
        case PREDICTOR_TYPES.EXPERIENCE:
          this._instances[type] = new ExperiencePredictor();
          break;
        case PREDICTOR_TYPES.MANUAL:
          this._instances[type] = new ManualMarkPredictor();
          break;
        // v5.2 新增：智能融合
        case PREDICTOR_TYPES.FUSION:
          this._instances[type] = new FusionPredictor();
          break;
        default:
          this._instances[type] = new ExperiencePredictor();
      }
    }
    return this._instances[type];
  },

  getAll() {
    return [
      this.get(PREDICTOR_TYPES.PATTERN),
      this.get(PREDICTOR_TYPES.EXPERIENCE),
      this.get(PREDICTOR_TYPES.MANUAL),
      this.get(PREDICTOR_TYPES.FUSION), // v5.2 新增
    ];
  },

  getAutoPredictors() {
    return [
      this.get(PREDICTOR_TYPES.PATTERN),
      this.get(PREDICTOR_TYPES.EXPERIENCE),
      this.get(PREDICTOR_TYPES.FUSION), // v5.2 新增
    ];
  },
};

// ==================== 组合预测适配 ====================

// 形态匹配算法的组合预测
function predictZuhePattern(seq, sumSeq, labels, options = {}) {
  const { sumMin = 3, sumMax = 19, topN = 3 } = options;
  const wSeq = getWindowedSeq(seq);
  const wSum = sumSeq ? getWindowedSeq(sumSeq) : null;

  const models = [];
  const patternLengths = [2, 3];

  for (const L of patternLengths) {
    const m = singlePatternModel(wSeq, labels, L, Settings.zuheMinSamples);
    if (m) {
      m.modelName = `${L}期形态`;
      m.weight = m.weight || 1;
      models.push(m);
    }
  }

  if (wSum && wSum.length === wSeq.length && Settings.zuheCrossFeature) {
    const crossM = crossFeatureModel(wSeq, wSum, labels, sumMin, sumMax, 2, Settings.zuheMinSamples);
    if (crossM) {
      crossM.weight *= 0.9;
      models.push(crossM);
    }
  }

  if (models.length === 0) {
    return { lean: '', pct: 0, sample: 0, final: {}, topN: [], confidence: '低', details: [] };
  }

  // 加权融合
  const scores = {};
  for (const lb of labels) scores[lb] = 0;
  let totalW = 0;

  for (const m of models) {
    const w = m.weight || 1;
    totalW += w;
    for (const lb of labels) {
      scores[lb] += (m.final[lb] || 0) * w;
    }
  }

  const final = {};
  for (const lb of labels) {
    final[lb] = totalW > 0 ? scores[lb] / totalW : 0;
  }

  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const topPct = sorted[0][1];
  const baseline = 100 / labels.length;

  let confidence;
  if (Math.abs(topPct - baseline) < 3) confidence = '低';
  else if (Math.abs(topPct - baseline) < 7) confidence = '中';
  else confidence = '高';

  return {
    lean: sorted[0][0],
    pct: Math.round(topPct * 100) / 100,
    sample: models.reduce((s, m) => s + (m.sample || 0), 0) / models.length,
    final,
    topN: sorted.slice(0, Math.min(topN, sorted.length)).map(([label, pct]) => ({
      label, pct: Math.round(pct * 100) / 100
    })),
    confidence,
    modelName: '形态匹配',
    predictorType: PREDICTOR_TYPES.PATTERN,
    details: models.map(m => ({
      name: m.modelName || '未知',
      lean: m.lean,
      pct: m.pct,
      sample: m.sample,
      weight: Math.round((m.weight || 0) * 100) / 100,
    })),
  };
}

// 手动标记算法的组合预测
function predictZuheManual(seq, labels, options = {}) {
  const { lotteryType = 'default', topN = 3 } = options;
  const manualPredictor = PredictorFactory.get(PREDICTOR_TYPES.MANUAL);
  const result = manualPredictor.predict(seq, labels, { lotteryType, category: '组合' });
  return result;
}
