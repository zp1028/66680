// v5.3 新增：扩展预测器 - 位置号码 & 组合预测
// 为位置预测和组合预测提供多算法切换 + 智能融合支持
// 遵循和大小单双相同的策略模式接口

// ==================== 位置预测：经验学习 ====================
// 内部复用 predictWithEWMA，和大小单双的经验学习同一套核心逻辑

class PositionExperiencePredictor {
  constructor(positionIndex = 0) {
    this.positionIndex = positionIndex;
    this.type = 'pos_experience';
    this.info = {
      name: '经验学习',
      shortName: '经验学习',
      icon: '🎯',
      description: '多模型集成，EWMA自适应加权',
      color: '#06b6d4',
    };
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const ewmaScores = options.ewmaScores || {};
    const modelCandidates = options.modelCandidates || MODEL_CANDIDATES;
    const topN = options.topN || 3;

    let model;
    if (Object.keys(ewmaScores).length > 0) {
      model = predictWithEWMA(seq, labels, ewmaScores, modelCandidates);
    } else {
      model = predictSelected(seq, labels);
    }

    if (!model || !model.final || Object.keys(model.final).length === 0) {
      return this._emptyResult(labels);
    }

    const topPicks = (model.topN || []).slice(0, topN);

    return {
      lean: model.lean || '',
      pct: model.pct || 0,
      sample: model.sample || 0,
      final: model.final,
      topN: topPicks,
      confidence: model.confidence || '低',
      modelName: model.selectedModel ? model.selectedModel.name : '自适应集成',
      details: model.details || [],
      selectedModel: model.selectedModel,
      pValue: model.pValue !== undefined ? model.pValue : 1.0,
      significant: model.significant || false,
    };
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: [],
      confidence: '低',
      modelName: '经验学习',
      details: [],
    };
  }
}

// ==================== 位置预测：形态匹配 ====================

class PositionPatternPredictor {
  constructor(positionIndex = 0) {
    this.positionIndex = positionIndex;
    this.type = 'pos_pattern';
    this.info = {
      name: '形态匹配',
      shortName: '形态匹配',
      icon: '📊',
      description: '查找历史相同形态，统计后续分布',
      color: '#4f46e5',
    };
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const wSeq = getWindowedSeq ? getWindowedSeq(seq) : seq;
    const minSamples = options.minSamples || 3; // 位置标签多，阈值低一些
    const patternLengths = [2, 3, 4];
    const models = [];

    for (const L of patternLengths) {
      const m = singlePatternModel(wSeq, labels, L, minSamples);
      if (m) {
        m.modelName = `${L}期形态`;
        m.weight = Math.sqrt(m.sample || 0) * (1 + (L - 2) * 0.2);
        models.push(m);
      }
    }

    if (models.length === 0) {
      return this._emptyResult(labels);
    }

    // 加权融合
    const final = {};
    for (const lb of labels) final[lb] = 0;
    let totalW = 0;

    for (const m of models) {
      totalW += m.weight;
      for (const lb of labels) {
        if (m.final && m.final[lb] !== undefined) {
          final[lb] += m.final[lb] * m.weight;
        }
      }
    }

    if (totalW > 0) {
      for (const lb of labels) final[lb] = final[lb] / totalW * 100 / 100; // 归一化
    }

    // 重新归一化确保总和100
    const sum = Object.values(final).reduce((s, v) => s + v, 0);
    if (sum > 0) {
      for (const lb of labels) final[lb] = final[lb] / sum * 100;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const avgSample = models.reduce((s, m) => s + (m.sample || 0), 0) / models.length;
    const topN = options.topN || 3;

    const baseline = 100 / labels.length;
    let confidence;
    if (avgSample < 5 || topPct < baseline * 1.3) confidence = '低';
    else if (avgSample < 15 || topPct < baseline * 1.8) confidence = '中';
    else confidence = '高';

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: Math.round(avgSample),
      final,
      topN: sorted.slice(0, topN).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100,
      })),
      confidence,
      modelName: '形态匹配',
      details: models.map(m => ({
        name: m.modelName,
        lean: m.lean,
        pct: m.pct,
        sample: m.sample,
        weight: Math.round(m.weight * 100) / 100,
      })),
    };
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: [],
      confidence: '低',
      modelName: '形态匹配',
      details: [],
    };
  }
}

// ==================== 组合预测：经验学习 ====================
// 内部复用 predictZuheEnhanced

class ComboExperiencePredictor {
  constructor() {
    this.type = 'combo_experience';
    this.info = {
      name: '经验学习',
      shortName: '经验学习',
      icon: '🎯',
      description: '多模型集成，含和值交叉特征',
      color: '#06b6d4',
    };
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const sumSeq = options.sumSeq || null;
    const ewmaScores = options.ewmaScores || null;
    const sumMin = options.sumMin || 3;
    const sumMax = options.sumMax || 19;
    const topN = options.topN || 3;

    const result = predictZuheEnhanced(seq, sumSeq, labels, {
      sumMin, sumMax, ewmaScores, topN,
    });

    if (!result || !result.final || Object.keys(result.final).length === 0) {
      return this._emptyResult(labels);
    }

    return {
      lean: result.lean || '',
      pct: result.pct || 0,
      sample: result.sample || 0,
      final: result.final,
      topN: result.topN || [],
      confidence: result.confidence || '低',
      modelName: result.selectedModel ? result.selectedModel.name : '组合增强',
      details: result.details || [],
      selectedModel: result.selectedModel,
      pValue: result.pValue !== undefined ? result.pValue : 1.0,
      significant: result.significant || false,
    };
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: [],
      confidence: '低',
      modelName: '经验学习',
      details: [],
    };
  }
}

// ==================== 组合预测：形态匹配 ====================

class ComboPatternPredictor {
  constructor() {
    this.type = 'combo_pattern';
    this.info = {
      name: '形态匹配',
      shortName: '形态匹配',
      icon: '📊',
      description: '查找历史相同形态，统计后续分布',
      color: '#4f46e5',
    };
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const wSeq = getWindowedSeq ? getWindowedSeq(seq) : seq;
    const minSamples = options.minSamples || Settings.zuheMinSamples || 3;
    const patternLengths = Settings.zuhePatternLengths || [2, 3];
    const topN = options.topN || 3;
    const models = [];

    for (const L of patternLengths) {
      const m = singlePatternModel(wSeq, labels, L, minSamples);
      if (m) {
        m.modelName = `${L}期形态`;
        m.weight = Math.sqrt(m.sample || 0) * 1.0;
        models.push(m);
      }
    }

    if (models.length === 0) {
      return this._emptyResult(labels);
    }

    // 加权融合
    const final = {};
    for (const lb of labels) final[lb] = 0;
    let totalW = 0;

    for (const m of models) {
      totalW += m.weight;
      for (const lb of labels) {
        if (m.final && m.final[lb] !== undefined) {
          final[lb] += m.final[lb] * m.weight;
        }
      }
    }

    // 归一化
    const sum = Object.values(final).reduce((s, v) => s + v, 0);
    if (sum > 0) {
      for (const lb of labels) final[lb] = final[lb] / sum * 100;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const avgSample = models.reduce((s, m) => s + (m.sample || 0), 0) / models.length;
    const baseline = 100 / labels.length;

    let confidence;
    if (avgSample < minSamples || topPct < baseline * 1.3) confidence = '低';
    else if (avgSample < 15 || topPct < baseline * 1.8) confidence = '中';
    else confidence = '高';

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: Math.round(avgSample),
      final,
      topN: sorted.slice(0, topN).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100,
      })),
      confidence,
      modelName: '形态匹配',
      details: models.map(m => ({
        name: m.modelName,
        lean: m.lean,
        pct: m.pct,
        sample: m.sample,
        weight: Math.round(m.weight * 100) / 100,
      })),
    };
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: [],
      confidence: '低',
      modelName: '形态匹配',
      details: [],
    };
  }
}

// ==================== 通用：智能融合适配器 ====================
// 适配 FusionPredictor 到位置/组合场景
// 因为 FusionPredictor 内部使用高级模型，支持任意标签，所以直接复用

class MultiLabelFusionPredictor {
  constructor(category = 'position') {
    this.category = category; // 'position' | 'combo'
    this.type = category === 'position' ? 'pos_fusion' : 'combo_fusion';
    this.info = {
      name: '智能融合',
      shortName: '智能融合',
      icon: '🔮',
      description: '多算法智能加权融合',
      color: '#8b5cf6',
    };
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 3) {
      return this._emptyResult(labels);
    }

    const fusionPred = new FusionPredictor();
    const result = fusionPred.predict(seq, labels, options);

    // 确保 topN 字段正确（多标签场景需要更多Top结果）
    const topN = options.topN || 3;
    if (result.topN && result.topN.length > topN) {
      result.topN = result.topN.slice(0, topN);
    }

    return result;
  }

  _emptyResult(labels) {
    const final = {};
    for (const lb of labels) final[lb] = 100 / labels.length;
    return {
      lean: labels[0] || '',
      pct: 100 / labels.length,
      sample: 0,
      final,
      topN: [],
      confidence: '低',
      modelName: '智能融合',
      details: [],
      subPredictions: [],
      weights: [],
    };
  }
}

// ==================== 预测器工厂扩展 ====================
// 为位置和组合提供独立的预测器获取函数

const PosPredictorFactory = {
  _instances: {},

  get(algo, positionIndex = 0) {
    const key = `${algo}_${positionIndex}`;
    if (!this._instances[key]) {
      switch (algo) {
        case 'experience':
          this._instances[key] = new PositionExperiencePredictor(positionIndex);
          break;
        case 'pattern':
          this._instances[key] = new PositionPatternPredictor(positionIndex);
          break;
        case 'fusion':
          this._instances[key] = new MultiLabelFusionPredictor('position');
          break;
        default:
          this._instances[key] = new PositionExperiencePredictor(positionIndex);
      }
    }
    return this._instances[key];
  },

  getAvailableAlgos() {
    return [
      { id: 'experience', name: '经验学习', icon: '🎯' },
      { id: 'pattern', name: '形态匹配', icon: '📊' },
      { id: 'fusion', name: '智能融合', icon: '🔮' },
    ];
  },
};

const ComboPredictorFactory = {
  _instances: {},

  get(algo) {
    if (!this._instances[algo]) {
      switch (algo) {
        case 'experience':
          this._instances[algo] = new ComboExperiencePredictor();
          break;
        case 'pattern':
          this._instances[algo] = new ComboPatternPredictor();
          break;
        case 'fusion':
          this._instances[algo] = new MultiLabelFusionPredictor('combo');
          break;
        default:
          this._instances[algo] = new ComboExperiencePredictor();
      }
    }
    return this._instances[algo];
  },

  getAvailableAlgos() {
    return [
      { id: 'experience', name: '经验学习', icon: '🎯' },
      { id: 'pattern', name: '形态匹配', icon: '📊' },
      { id: 'fusion', name: '智能融合', icon: '🔮' },
    ];
  },
};

// ==================== 融合配置扩展 ====================
// 位置和组合各有独立的融合配置

const FusionMultiConfig = {
  _key: 'cai31_fusion_multi_config',

  defaults: {
    position: {
      strategy: 'ewma',
      enabledModels: ['markov1', 'bayesian', 'weightedFreq', 'multiScale'],
    },
    combo: {
      strategy: 'ewma',
      enabledModels: ['markov1', 'bayesian', 'weightedFreq', 'multiScale'],
    },
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) {
        const data = JSON.parse(raw);
        return this._deepMerge(this.defaults, data);
      }
    } catch (e) {
      console.warn('加载多场景融合配置失败:', e);
    }
    return JSON.parse(JSON.stringify(this.defaults));
  },

  save(config) {
    try {
      localStorage.setItem(this._key, JSON.stringify(config));
    } catch (e) {
      console.warn('保存多场景融合配置失败:', e);
    }
  },

  getCategory(category) {
    const config = this.load();
    return config[category] || { strategy: 'ewma', enabledModels: [] };
  },

  updateStrategy(category, strategy) {
    const config = this.load();
    if (!config[category]) config[category] = { strategy: 'ewma', enabledModels: [] };
    config[category].strategy = strategy;
    this.save(config);
    return config;
  },

  toggleModel(category, modelId) {
    const config = this.load();
    if (!config[category]) config[category] = { strategy: 'ewma', enabledModels: [] };
    const idx = config[category].enabledModels.indexOf(modelId);
    if (idx >= 0) {
      config[category].enabledModels.splice(idx, 1);
    } else {
      config[category].enabledModels.push(modelId);
    }
    this.save(config);
    return config;
  },

  setEnabledModels(category, modelIds) {
    const config = this.load();
    if (!config[category]) config[category] = { strategy: 'ewma', enabledModels: [] };
    config[category].enabledModels = modelIds;
    this.save(config);
    return config;
  },

  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  },
};
