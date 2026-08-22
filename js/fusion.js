// v5.2 新增：智能融合引擎
// 作为第4种预测器，融合多个子模型的预测结果
// 支持4种融合策略：等权平均 / EWMA自适应 / 置信度加权 / 一致性投票
// 独立模块，不修改现有预测器代码

// ==================== 融合策略枚举 ====================
const FUSION_STRATEGIES = {
  EQUAL: 'equal',           // 等权平均
  EWMA: 'ewma',             // EWMA自适应（默认）
  CONFIDENCE: 'confidence', // 置信度加权
  CONSENSUS: 'consensus',   // 一致性投票
};

const FUSION_STRATEGY_INFO = {
  [FUSION_STRATEGIES.EQUAL]: {
    name: '等权平均',
    icon: '⚖️',
    description: '所有模型权重相同，最保守稳定',
  },
  [FUSION_STRATEGIES.EWMA]: {
    name: 'EWMA自适应',
    icon: '📈',
    description: '根据历史对错动态加权，智能调整',
  },
  [FUSION_STRATEGIES.CONFIDENCE]: {
    name: '置信度加权',
    icon: '🎯',
    description: '按每个模型的置信度分配权重',
  },
  [FUSION_STRATEGIES.CONSENSUS]: {
    name: '一致性投票',
    icon: '🗳️',
    description: '多数派胜出，无过半数则观望',
  },
};

// ==================== 融合预测器 ====================

class FusionPredictor {
  constructor() {
    this.type = 'fusion';
    this.info = {
      name: '智能融合模式',
      shortName: '智能融合',
      icon: '🔮',
      description: '融合多算法智能加权，综合决策',
      type: 'auto',
      color: '#8b5cf6',
    };
  }

  // 主预测接口
  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 3) {
      return this._emptyResult(labels);
    }

    const strategy = options.fusionStrategy || FUSION_STRATEGIES.EWMA;
    const enabledModelIds = options.enabledModels || this._getDefaultModels();
    const ewmaScores = options.ewmaScores || null;
    const ewmaMgr = options.ewmaMgr || null;
    const category = options.category || 'dx';

    // 1. 收集所有子模型的预测结果
    const subPredictions = this._collectSubPredictions(
      seq, labels, enabledModelIds, options
    );

    if (subPredictions.length === 0) {
      return this._emptyResult(labels);
    }

    // 2. 计算各模型的权重
    const weights = this._computeWeights(subPredictions, {
      strategy,
      ewmaScores,
      ewmaMgr,
      category,
      labels,
    });

    // 3. 执行融合
    const fusedResult = this._fuse(subPredictions, weights, labels, strategy);

    // 4. 计算融合置信度
    const avgSample = subPredictions.reduce((s, p) => s + (p.sample || 0), 0) / subPredictions.length;
    const agreement = this._calcAgreement(subPredictions, labels);
    const confidence = this._computeFusionConfidence(
      fusedResult.final, labels, avgSample, agreement, subPredictions.length, strategy
    );

    // 5. 整理输出
    const sorted = Object.entries(fusedResult.final).sort((a, b) => b[1] - a[1]);

    // v5.4 新增：融合 p 值（按权重加权几何平均）
    let pValue = 1.0;
    if (subPredictions.length > 0 && weights.length > 0) {
      let sumLogP = 0;
      let totalW = 0;
      for (let i = 0; i < subPredictions.length; i++) {
        const w = weights[i] || 0;
        const p = subPredictions[i].pValue !== undefined ? subPredictions[i].pValue : 1.0;
        totalW += w;
        sumLogP += w * Math.log(Math.max(p, 1e-10));
      }
      if (totalW > 0) {
        pValue = Math.exp(sumLogP / totalW);
      }
    }

    return {
      lean: sorted[0][0],
      pct: Math.round(sorted[0][1] * 100) / 100,
      sample: Math.round(avgSample),
      final: fusedResult.final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100,
      })),
      confidence,
      modelName: '智能融合',
      fusionStrategy: strategy,
      pValue,
      details: subPredictions.map((p, i) => ({
        name: p.modelName || p.name,
        lean: p.lean,
        pct: p.pct,
        sample: p.sample,
        weight: Math.round(weights[i] * 100) / 100,
        pValue: p.pValue,
      })),
      subPredictions,
      weights,
    };
  }

  // 收集子模型预测结果
  _collectSubPredictions(seq, labels, enabledIds, options) {
    const results = [];

    // 从高级算法模型收集
    for (const id of enabledIds) {
      const model = createAdvancedModel(id);
      if (model) {
        try {
          const result = model.predict(seq, labels, options);
          if (result && result.final && Object.keys(result.final).length > 0) {
            result._modelId = id;
            result._source = 'advanced';
            results.push(result);
          }
        } catch (e) {
          console.warn(`融合模型 ${id} 预测失败:`, e);
        }
      }
    }

    return results;
  }

  // 计算各模型权重
  _computeWeights(predictions, params) {
    const { strategy, ewmaScores, ewmaMgr, category, labels } = params;
    const n = predictions.length;
    if (n === 0) return [];

    switch (strategy) {
      case FUSION_STRATEGIES.EQUAL:
        return this._weightsEqual(n);

      case FUSION_STRATEGIES.EWMA:
        return this._weightsEwma(predictions, category, ewmaScores, ewmaMgr, labels);

      case FUSION_STRATEGIES.CONFIDENCE:
        return this._weightsConfidence(predictions, labels);

      case FUSION_STRATEGIES.CONSENSUS:
        return this._weightsConsensus(predictions, labels);

      default:
        return this._weightsEqual(n);
    }
  }

  // 策略1：等权平均
  _weightsEqual(n) {
    return Array(n).fill(1 / n);
  }

  // 策略2：EWMA自适应加权
  _weightsEwma(predictions, category, ewmaScores, ewmaMgr, labels) {
    const n = predictions.length;
    const baseline = 1 / labels.length;

    // 基础权重：基于样本量
    const baseWeights = predictions.map(p => {
      const sample = p.sample || 0;
      return Math.sqrt(sample + 1); // +1 避免0样本权重为0
    });

    // 如果有EWMA评分，叠加加权
    let ewmaBoost = predictions.map(() => 1);
    if (ewmaScores && ewmaScores[category]) {
      const scores = ewmaScores[category];
      predictions.forEach((p, i) => {
        const modelName = p.modelName || '';
        // 尝试匹配模型名对应的EWMA评分
        let bestMatchScore = null;
        for (const [key, val] of Object.entries(scores)) {
          if (modelName.includes(key) || key.includes(modelName)) {
            if (bestMatchScore === null || val > bestMatchScore) {
              bestMatchScore = val;
            }
          }
        }
        if (bestMatchScore !== null) {
          // EWMA加权：评分越高权重越大
          const temperature = Settings.ewmaWeightTemperature || 0.08;
          ewmaBoost[i] = Math.exp((bestMatchScore - baseline) / temperature);
        }
      });
    }

    // 计算最终权重
    const rawWeights = baseWeights.map((bw, i) => bw * ewmaBoost[i]);
    const totalW = rawWeights.reduce((s, w) => s + w, 0);

    if (totalW <= 0) return this._weightsEqual(n);
    return rawWeights.map(w => w / totalW);
  }

  // 策略3：置信度加权
  _weightsConfidence(predictions, labels) {
    const n = predictions.length;
    const baseline = 100 / labels.length;

    // 置信度分数：概率优势 × 样本量因子
    const confScores = predictions.map(p => {
      const topPct = p.pct || baseline;
      const advantage = Math.max(0, topPct - baseline);
      const sampleFactor = Math.sqrt((p.sample || 0) + 1);
      return advantage * sampleFactor + 0.1; // +0.1 避免0权重
    });

    const total = confScores.reduce((s, v) => s + v, 0);
    if (total <= 0) return this._weightsEqual(n);
    return confScores.map(v => v / total);
  }

  // 策略4：一致性投票（多数派加权）
  _weightsConsensus(predictions, labels) {
    const n = predictions.length;
    const votes = {};
    for (const lb of labels) votes[lb] = 0;

    for (const p of predictions) {
      if (p.lean && votes[p.lean] !== undefined) {
        votes[p.lean]++;
      }
    }

    // 找得票最高的
    const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const topVotes = sortedVotes[0][1];
    const majorityThreshold = n / 2;

    if (topVotes < majorityThreshold) {
      // 无过半数，所有预测一致的方向等权，不一致的降权
      const agreementFactor = topVotes / n;
      return predictions.map(p => {
        if (p.lean === sortedVotes[0][0]) return agreementFactor / topVotes;
        return (1 - agreementFactor) / (n - topVotes || 1);
      });
    }

    // 有过半数，多数派权重高
    return predictions.map(p => {
      if (p.lean === sortedVotes[0][0]) return 0.8 / topVotes;
      return 0.2 / (n - topVotes || 1);
    });
  }

  // 执行融合计算
  _fuse(predictions, weights, labels, strategy) {
    const final = {};
    for (const lb of labels) final[lb] = 0;

    for (let i = 0; i < predictions.length; i++) {
      const p = predictions[i];
      const w = weights[i];
      if (!p.final) continue;
      for (const lb of labels) {
        if (p.final[lb] !== undefined) {
          final[lb] += p.final[lb] * w;
        }
      }
    }

    // 归一化（确保总和为100）
    const total = Object.values(final).reduce((s, v) => s + v, 0);
    if (total > 0) {
      for (const lb of labels) {
        final[lb] = final[lb] / total * 100;
      }
    }

    // 一致性投票策略：如果无过半数，标记为"观望"
    let isWaitAndSee = false;
    if (strategy === FUSION_STRATEGIES.CONSENSUS) {
      const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
      const baseline = 100 / labels.length;
      if (sorted[0][1] < baseline * 1.3) {
        isWaitAndSee = true;
      }
    }

    return { final, isWaitAndSee };
  }

  // 计算模型间一致性（0~1，越高越一致）
  _calcAgreement(predictions, labels) {
    if (predictions.length < 2) return 1;

    // 用余弦相似度的平均值衡量一致性
    let totalSim = 0;
    let pairs = 0;

    for (let i = 0; i < predictions.length; i++) {
      for (let j = i + 1; j < predictions.length; j++) {
        const sim = this._cosineSimilarity(predictions[i].final, predictions[j].final, labels);
        totalSim += sim;
        pairs++;
      }
    }

    return pairs > 0 ? totalSim / pairs : 1;
  }

  // 余弦相似度
  _cosineSimilarity(distA, distB, labels) {
    if (!distA || !distB) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (const lb of labels) {
      const a = distA[lb] || 0;
      const b = distB[lb] || 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  // 计算融合置信度
  _computeFusionConfidence(finalProbs, labels, avgSample, agreement, modelCount, strategy) {
    const sorted = Object.entries(finalProbs).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;
    const advantage = topPct - baseline;

    // 基础分：概率优势
    let score = Math.min(100, advantage * 3);

    // 样本量加成
    const sampleFactor = Math.min(1, avgSample / 50);
    score *= (0.5 + 0.5 * sampleFactor);

    // 一致性加成（模型越一致，置信度越高）
    score *= (0.7 + 0.3 * agreement);

    // 模型数量加成（模型越多，越可靠，但边际递减）
    const modelFactor = Math.min(1, modelCount / 5);
    score *= (0.8 + 0.2 * modelFactor);

    // 一致性投票策略特殊处理
    if (strategy === FUSION_STRATEGIES.CONSENSUS && advantage < baseline * 0.3) {
      return '低';
    }

    if (score < 15) return '低';
    if (score < 30) return '中';
    if (score < 50) return '高';
    return '推荐';
  }

  // 默认启用的模型
  _getDefaultModels() {
    return ['markov1', 'bayesian', 'weightedFreq', 'multiScale', 'coldHotOmission'];
  }

  // 空结果
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
      modelName: '智能融合',
      pValue: 1.0,
      details: [],
      subPredictions: [],
      weights: [],
    };
  }
}

// ==================== 融合配置管理 ====================

const FusionConfig = {
  _key: 'cai31_fusion_config',

  defaults: {
    strategy: FUSION_STRATEGIES.EWMA,
    enabledModels: ['markov1', 'bayesian', 'weightedFreq', 'multiScale', 'coldHotOmission'],
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) {
        const data = JSON.parse(raw);
        return { ...this.defaults, ...data };
      }
    } catch (e) {
      console.warn('加载融合配置失败:', e);
    }
    return { ...this.defaults };
  },

  save(config) {
    try {
      localStorage.setItem(this._key, JSON.stringify(config));
    } catch (e) {
      console.warn('保存融合配置失败:', e);
    }
  },

  update(key, value) {
    const config = this.load();
    config[key] = value;
    this.save(config);
    return config;
  },

  toggleModel(modelId) {
    const config = this.load();
    const idx = config.enabledModels.indexOf(modelId);
    if (idx >= 0) {
      config.enabledModels.splice(idx, 1);
    } else {
      config.enabledModels.push(modelId);
    }
    this.save(config);
    return config;
  },
};
