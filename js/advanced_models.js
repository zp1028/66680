// v5.2 新增：高级算法模型库
// 独立模块，不影响现有预测器
// 所有模型实现统一接口：predict(seq, labels, options) -> result
// result 格式：{ lean, pct, sample, final, topN, confidence, modelName, details }

// ==================== 模型一：马尔可夫链 ====================
// 原理：构建一阶状态转移概率矩阵，用前一期状态预测下一期
// 特点：简单高效，适合样本充足的场景

class MarkovModel {
  constructor(order = 1) {
    this.order = order; // 阶数：1=一阶马尔可夫，2=二阶
    this.modelName = order === 1 ? '马尔可夫链' : `${order}阶马尔可夫`;
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < this.order + 2) {
      return this._emptyResult(labels);
    }

    const minSamples = options.minSamples || Settings.predictionMinSamples;
    const alpha = options.alpha || Settings.predictionAlpha || 1.0;
    const wSeq = getWindowedSeq ? getWindowedSeq(seq) : seq;

    // 构建转移计数矩阵
    const transitionCounts = {}; // { "state": { nextState: count } }
    let totalTransitions = 0;

    for (let i = this.order; i < wSeq.length - 1; i++) {
      const state = wSeq.slice(i - this.order, i).join(',');
      const nextState = wSeq[i];
      if (!transitionCounts[state]) transitionCounts[state] = {};
      transitionCounts[state][nextState] = (transitionCounts[state][nextState] || 0) + 1;
      totalTransitions++;
    }

    // 获取当前状态
    const currentState = wSeq.slice(-this.order).join(',');
    const counts = transitionCounts[currentState] || {};
    const sample = Object.values(counts).reduce((s, v) => s + v, 0);

    if (sample < minSamples) {
      return {
        ...this._emptyResult(labels),
        sample,
        warning: '马尔可夫样本不足',
      };
    }

    // 拉普拉斯平滑
    const denom = sample + alpha * labels.length;
    const final = {};
    for (const lb of labels) {
      final[lb] = ((counts[lb] || 0) + alpha) / denom * 100;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;

    let confidence;
    if (sample < minSamples || Math.abs(topPct - baseline) < 3) confidence = '低';
    else if (sample < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
    else confidence = '高';

    // v5.4 新增：计算 p 值
    const pValue = computePValueFromDist(final, sample, labels);

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: this.modelName,
      pValue,
      details: [{
        name: this.modelName,
        lean: sorted[0][0],
        pct: Math.round(topPct * 100) / 100,
        sample,
        weight: Math.sqrt(sample) * 0.8,
        pValue,
      }],
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
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: this.modelName,
      pValue: 1.0,
      details: [],
    };
  }
}

// ==================== 模型二：贝叶斯平滑 ====================
// 原理：用Beta先验分布对频率做贝叶斯后验估计
// 特点：小样本下更稳健，不会出现极端概率
// 先验强度由 priorStrength 控制，值越大越保守

class BayesianSmoothModel {
  constructor(priorStrength = 2) {
    this.priorStrength = priorStrength; // 先验强度（等效于先验样本数）
    this.modelName = '贝叶斯平滑';
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 3) {
      return this._emptyResult(labels);
    }

    const window = options.window || 30;
    const wSeq = getWindowedSeq ? getWindowedSeq(seq, window) : seq.slice(-window);

    // 统计各标签出现次数
    const counts = {};
    for (const lb of labels) counts[lb] = 0;
    for (const v of wSeq) {
      if (counts[v] !== undefined) counts[v]++;
    }

    const total = wSeq.length;
    const priorAlpha = this.priorStrength; // 每个标签的先验伪计数

    // 后验概率 = (观测数 + 先验) / (总数 + 先验总数)
    const denom = total + priorAlpha * labels.length;
    const final = {};
    for (const lb of labels) {
      final[lb] = (counts[lb] + priorAlpha) / denom * 100;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;

    let confidence;
    if (total < 10 || Math.abs(topPct - baseline) < 2) confidence = '低';
    else if (total < 20 || Math.abs(topPct - baseline) < 5) confidence = '中';
    else confidence = '高';

    // v5.4 新增：计算 p 值
    const pValue = computePValueFromDist(final, total, labels);

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: total,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: this.modelName,
      pValue,
      details: [{
        name: this.modelName,
        lean: sorted[0][0],
        pct: Math.round(topPct * 100) / 100,
        sample: total,
        weight: Math.sqrt(total) * 0.7,
        pValue,
      }],
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
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: this.modelName,
      pValue: 1.0,
      details: [],
    };
  }
}

// ==================== 模型三：指数加权频率 ====================
// 原理：越近期的数据权重越高（指数衰减）
// 特点：能快速捕捉短期趋势变化
// decay: 衰减因子，越小越看重近期（0.95=半衰期约13期，0.9=约7期）

class WeightedFreqModel {
  constructor(decay = 0.9) {
    this.decay = decay;
    this.modelName = `加权频率(${decay})`;
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const wSeq = getWindowedSeq ? getWindowedSeq(seq) : seq;
    const alpha = options.alpha || 1.0;

    // 指数加权统计（从旧到新，越新权重越大）
    const weightedCounts = {};
    let totalWeight = 0;

    for (let i = 0; i < wSeq.length; i++) {
      const weight = Math.pow(this.decay, wSeq.length - 1 - i);
      const val = wSeq[i];
      if (weightedCounts[val] === undefined) weightedCounts[val] = 0;
      weightedCounts[val] += weight;
      totalWeight += weight;
    }

    // 等效样本量（基于有效权重）
    const effectiveSample = Math.round(totalWeight * 10) / 10;

    // 平滑 + 归一化
    const denom = totalWeight + alpha * labels.length;
    const final = {};
    for (const lb of labels) {
      final[lb] = ((weightedCounts[lb] || 0) + alpha) / denom * 100;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;

    let confidence;
    if (effectiveSample < 8 || Math.abs(topPct - baseline) < 3) confidence = '低';
    else if (effectiveSample < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
    else confidence = '高';

    // v5.4 新增：计算 p 值
    const pValue = computePValueFromDist(final, effectiveSample, labels);

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: effectiveSample,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: this.modelName,
      pValue,
      details: [{
        name: this.modelName,
        lean: sorted[0][0],
        pct: Math.round(topPct * 100) / 100,
        sample: effectiveSample,
        weight: Math.sqrt(effectiveSample) * 0.75,
        pValue,
      }],
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
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: this.modelName,
      pValue: 1.0,
      details: [],
    };
  }
}

// ==================== 模型四：位置分布模型 ====================
// 原理：分析每个位置上的号码频率分布
// 特点：适合位置号码预测（如冠军位置的冷热号分析）

class PositionDistModel {
  constructor(window = 50) {
    this.window = window;
    this.modelName = `位置分布(${window}期)`;
  }

  predict(numSeq, numRange, options = {}) {
    if (!numSeq || numSeq.length < 10) {
      return { topN: [], lean: null, pct: 0, sample: 0, confidence: '低', details: [] };
    }

    const topN = options.topN || 3;
    const wSeq = numSeq.slice(-this.window);
    const alpha = options.alpha || 0.5;

    const counts = {};
    for (const n of numRange) counts[n] = 0;
    for (const v of wSeq) {
      if (counts[v] !== undefined) counts[v]++;
    }

    const total = wSeq.length;
    const denom = total + alpha * numRange.length;

    const probs = {};
    for (const n of numRange) {
      probs[n] = (counts[n] + alpha) / denom * 100;
    }

    const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    const topPicks = sorted.slice(0, topN).map(([num, pct]) => ({
      number: parseInt(num),
      pct: Math.round(pct * 100) / 100,
    }));

    const baseline = 100 / numRange.length;
    const topPct = topPicks[0]?.pct || 0;

    // v5.4 新增：计算 p 值
    const pValue = computePValueFromDist(probs, total, numRange.map(String));

    let confidence;
    if (total < 20 || topPct < baseline * 1.5) confidence = '低';
    else if (total < 50 || topPct < baseline * 2) confidence = '中';
    else confidence = '高';

    return {
      topN: topPicks,
      lean: topPicks[0]?.number || null,
      pct: topPct,
      sample: total,
      confidence,
      modelName: this.modelName,
      pValue,
      details: [{
        name: this.modelName,
        lean: topPicks[0]?.number,
        pct: topPct,
        sample: total,
        weight: Math.sqrt(total) * 0.6,
        pValue,
      }],
    };
  }
}

// ==================== 模型五：多尺度频率融合 ====================
// 原理：融合多个时间窗口的频率结果（超短/短期/中期/长期）
// 特点：兼顾短期趋势和长期稳定性

class MultiScaleFreqModel {
  constructor() {
    this.modelName = '多尺度频率';
    this.windows = [5, 10, 20, 50];
    this.windowWeights = [1.2, 1.0, 0.8, 0.6]; // 短窗口权重高
  }

  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const wSeq = getWindowedSeq ? getWindowedSeq(seq) : seq;
    const models = [];

    for (let i = 0; i < this.windows.length; i++) {
      const w = this.windows[i];
      if (wSeq.length < w) continue;

      const subSeq = wSeq.slice(-w);
      const counts = {};
      for (const lb of labels) counts[lb] = 0;
      for (const v of subSeq) {
        if (counts[v] !== undefined) counts[v]++;
      }

      const total = subSeq.length;
      const final = {};
      const denom = total + labels.length;
      for (const lb of labels) {
        final[lb] = (counts[lb] + 1) / denom * 100;
      }

      const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
      const pValue = computePValueFromDist(final, total, labels);
      models.push({
        modelName: `${w}期频`,
        lean: sorted[0][0],
        pct: sorted[0][1],
        sample: total,
        final,
        weight: this.windowWeights[i] * Math.sqrt(total),
        pValue,
      });
    }

    if (models.length === 0) return this._emptyResult(labels);

    // 加权融合
    const scores = {};
    for (const lb of labels) scores[lb] = 0;
    let totalW = 0;

    for (const m of models) {
      totalW += m.weight;
      for (const lb of labels) {
        scores[lb] += m.final[lb] * m.weight;
      }
    }

    const final = {};
    for (const lb of labels) {
      final[lb] = totalW > 0 ? scores[lb] / totalW : 100 / labels.length;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;
    const avgSample = models.reduce((s, m) => s + m.sample, 0) / models.length;

    // v5.4 新增：融合 p 值（按权重加权几何平均）
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

    let confidence;
    if (avgSample < 10 || Math.abs(topPct - baseline) < 3) confidence = '低';
    else if (avgSample < 25 || Math.abs(topPct - baseline) < 7) confidence = '中';
    else confidence = '高';

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: Math.round(avgSample * 10) / 10,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: this.modelName,
      pValue,
      details: models.map(m => ({
        name: m.modelName,
        lean: m.lean,
        pct: Math.round(m.pct * 100) / 100,
        sample: m.sample,
        weight: Math.round(m.weight * 100) / 100,
        pValue: m.pValue,
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
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: this.modelName,
      pValue: 1.0,
      details: [],
    };
  }
}

// ==================== 模型六：冷热遗漏模型（v5.4新增） ====================
// 原理：分析每个标签的遗漏期数，结合冷热转换理论 + 随机变量
// 特点：
//   - 遗漏越久的标签，回补概率越高（均值回归）
//   - 加入随机变量扰动，避免过拟合
//   - 支持大小、单双、组合、位置号码等所有场景
//   - 独立模型，与其他模型区分开

class ColdHotOmissionModel {
  constructor(options = {}) {
    this.modelName = '冷热遗漏';
    this.randomStrength = options.randomStrength || 0.15; // 随机扰动强度 (0~1)
    this.omitBoostFactor = options.omitBoostFactor || 0.8; // 遗漏增强系数
    this.window = options.window || 50; // 统计窗口
    this.seed = options.seed || null; // 随机种子（可选，用于复现）
  }

  // 简易伪随机数生成器（Mulberry32）
  _mulberry32(seed) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // 获取随机数生成器
  _getRng() {
    if (this.seed !== null) {
      return this._mulberry32(this.seed);
    }
    return Math.random;
  }

  // 计算每个标签的遗漏期数
  _computeOmission(seq, labels) {
    const omission = {};
    for (const lb of labels) {
      omission[lb] = seq.length; // 默认最大遗漏
    }

    // 从后往前找，记录每个标签最后一次出现的位置
    for (let i = seq.length - 1; i >= 0; i--) {
      const val = seq[i];
      if (omission[val] !== undefined && omission[val] === seq.length) {
        omission[val] = seq.length - 1 - i;
      }
    }

    return omission;
  }

  // 计算历史平均遗漏期数（用于归一化）
  _computeAvgOmission(seq, labels) {
    const lastOccurrence = {};
    const omissionSums = {};
    const omissionCounts = {};

    for (const lb of labels) {
      lastOccurrence[lb] = -1;
      omissionSums[lb] = 0;
      omissionCounts[lb] = 0;
    }

    for (let i = 0; i < seq.length; i++) {
      const val = seq[i];
      if (lastOccurrence[val] !== undefined && lastOccurrence[val] >= 0) {
        const gap = i - lastOccurrence[val] - 1;
        omissionSums[val] += gap;
        omissionCounts[val]++;
      }
      lastOccurrence[val] = i;
    }

    const avgOmission = {};
    for (const lb of labels) {
      if (omissionCounts[lb] > 0) {
        avgOmission[lb] = omissionSums[lb] / omissionCounts[lb];
      } else {
        avgOmission[lb] = labels.length; // 默认值
      }
    }

    return avgOmission;
  }

  // 主预测接口（支持大小、单双、组合等标签型预测）
  predict(seq, labels, options = {}) {
    if (!seq || seq.length < 5) {
      return this._emptyResult(labels);
    }

    const wSeq = getWindowedSeq ? getWindowedSeq(seq, this.window) : seq.slice(-this.window);
    const rng = this._getRng();

    // 1. 计算当前遗漏期数
    const omission = this._computeOmission(wSeq, labels);

    // 2. 计算历史平均遗漏（作为基准）
    const avgOmission = this._computeAvgOmission(wSeq, labels);

    // 3. 基于遗漏度计算基础概率
    const baseScores = {};
    let totalBase = 0;

    for (const lb of labels) {
      const currentOmit = omission[lb];
      const avgOmit = avgOmission[lb] || 1;
      const omitRatio = currentOmit / Math.max(avgOmit, 1);

      // 遗漏增强：超过平均遗漏越多，概率越高
      // 使用S型函数，避免极端值
      const omitBoost = 1 / (1 + Math.exp(-this.omitBoostFactor * (omitRatio - 1)));

      // 基础分 = 均匀基准 * (1 + 遗漏增强)
      const baseline = 1 / labels.length;
      baseScores[lb] = baseline * (1 + omitBoost * this.omitBoostFactor);
      totalBase += baseScores[lb];
    }

    // 4. 归一化基础概率
    const normalizedBase = {};
    for (const lb of labels) {
      normalizedBase[lb] = baseScores[lb] / totalBase;
    }

    // 5. 加入随机变量扰动
    const randomNoise = {};
    let totalNoise = 0;
    for (const lb of labels) {
      // 在基础概率附近随机波动
      const noise = 1 + (rng() - 0.5) * 2 * this.randomStrength;
      randomNoise[lb] = Math.max(0.1, noise); // 避免负值
      totalNoise += normalizedBase[lb] * randomNoise[lb];
    }

    // 6. 最终概率分布
    const final = {};
    for (const lb of labels) {
      final[lb] = (normalizedBase[lb] * randomNoise[lb]) / totalNoise * 100;
    }

    const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
    const topPct = sorted[0][1];
    const baseline = 100 / labels.length;

    // 样本量等效值（基于窗口大小）
    const effectiveSample = Math.round(wSeq.length * 0.6);

    let confidence;
    const maxOmit = Math.max(...Object.values(omission));
    const avgOmitVal = Object.values(avgOmission).reduce((a, b) => a + b, 0) / labels.length;
    if (wSeq.length < 10 || maxOmit < avgOmitVal * 0.5) confidence = '低';
    else if (wSeq.length < 25 || maxOmit < avgOmitVal) confidence = '中';
    else confidence = '高';

    // v5.4 新增：计算 p 值
    const pValue = computePValueFromDist(final, effectiveSample, labels);

    return {
      lean: sorted[0][0],
      pct: Math.round(topPct * 100) / 100,
      sample: effectiveSample,
      final,
      topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({
        label, pct: Math.round(pct * 100) / 100
      })),
      confidence,
      modelName: this.modelName,
      pValue,
      // 冷热遗漏专属数据
      omissionData: {
        current: { ...omission },
        average: { ...avgOmission },
        maxOmission: maxOmit,
        coldLabels: sorted.slice(0, Math.ceil(labels.length / 2)).map(([lb]) => lb),
        hotLabels: sorted.slice(-Math.floor(labels.length / 2)).reverse().map(([lb]) => lb),
      },
      randomStrength: this.randomStrength,
      details: [
        {
          name: '遗漏分析',
          lean: sorted[0][0],
          pct: Math.round(topPct * 100) / 100,
          sample: effectiveSample,
          weight: Math.sqrt(effectiveSample) * 0.7,
          pValue,
        },
        {
          name: '随机扰动',
          lean: sorted[0][0],
          pct: null,
          sample: 0,
          weight: 0,
          note: `强度 ${Math.round(this.randomStrength * 100)}%`,
        },
      ],
    };
  }

  // 位置号码预测（专门用于号码冷热分析）
  predictNumbers(numSeq, numRange, options = {}) {
    const labels = numRange.map(String);
    const strSeq = numSeq.map(String);
    const topN = options.topN || 3;

    const result = this.predict(strSeq, labels, options);

    return {
      topN: result.topN.slice(0, topN).map(t => ({
        number: parseInt(t.label),
        pct: t.pct,
      })),
      lean: result.lean ? parseInt(result.lean) : null,
      pct: result.pct,
      sample: result.sample,
      confidence: result.confidence,
      modelName: this.modelName,
      pValue: result.pValue,
      omissionData: result.omissionData,
      final: result.final,
      details: result.details,
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
      topN: labels.map(l => ({ label: l, pct: Math.round(100 / labels.length * 100) / 100 })),
      confidence: '低',
      modelName: this.modelName,
      pValue: 1.0,
      omissionData: {
        current: {},
        average: {},
        maxOmission: 0,
        coldLabels: [],
        hotLabels: [],
      },
      randomStrength: this.randomStrength,
      details: [],
    };
  }
}

// ==================== 高级算法注册中心 ====================
// 所有新增算法在这里注册，融合引擎通过这里获取

const ADVANCED_MODELS = {
  markov1: {
    id: 'markov1',
    name: '马尔可夫链',
    shortName: '马尔可夫',
    icon: '🔄',
    category: '时序模型',
    description: '一阶状态转移概率，捕捉连续两期的关联',
    create: () => new MarkovModel(1),
  },
  markov2: {
    id: 'markov2',
    name: '二阶马尔可夫',
    shortName: '二阶马氏',
    icon: '🔁',
    category: '时序模型',
    description: '二阶状态转移，使用前两期预测下一期',
    create: () => new MarkovModel(2),
  },
  bayesian: {
    id: 'bayesian',
    name: '贝叶斯平滑',
    shortName: '贝叶斯',
    icon: '📐',
    category: '统计模型',
    description: '贝叶斯后验估计，小样本下更稳健',
    create: () => new BayesianSmoothModel(2),
  },
  weightedFreq: {
    id: 'weightedFreq',
    name: '加权频率',
    shortName: '加权频',
    icon: '⚖️',
    category: '频率模型',
    description: '指数加权频率，近期数据权重更高',
    create: () => new WeightedFreqModel(0.9),
  },
  multiScale: {
    id: 'multiScale',
    name: '多尺度频率',
    shortName: '多尺度',
    icon: '🎚️',
    category: '频率模型',
    description: '融合5/10/20/50期多窗口频率',
    create: () => new MultiScaleFreqModel(),
  },
  // v5.4 新增：冷热遗漏模型
  coldHotOmission: {
    id: 'coldHotOmission',
    name: '冷热遗漏',
    shortName: '冷热遗漏',
    icon: '🌡️',
    category: '遗漏模型',
    description: '基于遗漏期数+随机变量的冷热回补预测',
    create: () => new ColdHotOmissionModel({ randomStrength: 0.15, omitBoostFactor: 0.8 }),
  },
};

// 获取所有高级算法的元信息列表
function getAdvancedModelList() {
  return Object.values(ADVANCED_MODELS);
}

// 创建指定ID的高级模型实例
function createAdvancedModel(id) {
  const info = ADVANCED_MODELS[id];
  if (!info) return null;
  return info.create();
}

// 创建所有已启用的高级模型实例
function createAllAdvancedModels(enabledIds = null) {
  const models = [];
  const ids = enabledIds || Object.keys(ADVANCED_MODELS);
  for (const id of ids) {
    const m = createAdvancedModel(id);
    if (m) models.push(m);
  }
  return models;
}
