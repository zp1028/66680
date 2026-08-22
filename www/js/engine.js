// 预测引擎 v4.0：形态匹配 + 频率统计 + 自适应集成 + 滚动回测 + 统计检验 + TopN预测 + 位置预测 + 动态加权 + 连对连错 + EWMA自适应 + 窗口化 + 组合增强

// ==================== 数学工具 ====================

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) prob = 1 - prob;
  return prob;
}

function binomTestPValue(ok, n, p = 0.5, alternative = 'greater') {
  if (n <= 0) return 1.0;
  const mean = n * p;
  const std = Math.sqrt(n * p * (1 - p));
  if (std === 0) return ok >= mean ? 0.5 : 1.0;
  const z = (ok - mean - 0.5) / std;
  if (alternative === 'greater') return 1 - normalCdf(z);
  else if (alternative === 'less') return normalCdf(z);
  else return 2 * (1 - normalCdf(Math.abs(z)));
}

function binomialSignificance(ok, n, p = 0.5, alpha = null, bonferroniN = 1) {
  alpha = alpha || Settings.significanceAlpha;
  if (n <= 0 || ok < 0 || ok > n) return { significant: false, pValue: 1.0 };
  const adjustedAlpha = alpha / Math.max(bonferroniN, 1);
  const pValue = binomTestPValue(ok, n, p, 'greater');
  return { significant: pValue < adjustedAlpha, pValue: pValue };
}

// v5.4 新增：从概率分布 + 样本量计算 p 值（通用工具）
// 原理：假设均匀分布为零假设，观测到 top 标签比例 >= 当前比例的概率
function computePValueFromDist(final, sample, labels) {
  if (!sample || sample <= 0) return 1.0;
  const baseline = 1 / labels.length;
  const sorted = Object.entries(final || {}).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 1.0;
  const topPct = sorted[0][1] / 100; // 转为 0~1
  const ok = Math.round(sample * topPct);
  if (ok <= 0) return 1.0;
  return binomTestPValue(ok, sample, baseline, 'greater');
}

function wilsonInterval(ok, n, z = 1.96) {
  if (n <= 0) return [0.0, 100.0];
  const p = ok / n;
  const den = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
  return [Math.max(0.0, (center - half) * 100), Math.min(100.0, (center + half) * 100)];
}

// ==================== 路珠分析 ====================

function luzhuAfterPattern(seq, pattern) {
  const n = pattern.length;
  const counter = {};
  let total = 0;
  for (let i = 0; i <= seq.length - n - 1; i++) {
    let match = true;
    for (let j = 0; j < n; j++) {
      if (seq[i + j] !== pattern[j]) { match = false; break; }
    }
    if (match) {
      const nextVal = seq[i + n];
      counter[nextVal] = (counter[nextVal] || 0) + 1;
      total++;
    }
  }
  const result = { total, counter };
  for (const k in counter) {
    result[k] = counter[k];
    result[k + '%'] = total > 0 ? Math.round(counter[k] / total * 10000) / 100 : 0;
  }
  return result;
}

function patternStats(seq, pattern, alpha = null) {
  alpha = alpha || Settings.predictionAlpha;
  const labels = [...new Set(seq)].sort();
  const r = luzhuAfterPattern(seq, pattern);
  const total = r.total || 0;
  const smoothed = {};
  const denom = total + alpha * labels.length;
  for (const lb of labels) {
    smoothed[lb] = denom > 0 ? ((r[lb] || 0) + alpha) / denom * 100 : 0;
  }
  r.smoothPct = smoothed;
  return r;
}

// ==================== 单模型（返回全部分布，支持TopN） ====================

function singlePatternModel(seq, labels, length, minSamples = null, alpha = null) {
  minSamples = minSamples || Settings.predictionMinSamples;
  alpha = alpha || Settings.predictionAlpha;
  if (seq.length <= length) return null;
  const pattern = seq.slice(-length);
  const r = patternStats(seq, pattern, alpha);
  const total = r.total || 0;
  if (total <= 0) return null;

  const final = {};
  for (const lb of labels) final[lb] = parseFloat(r.smoothPct[lb] || 0);

  // 按概率排序的Top列表
  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const topLean = sorted[0][0];
  const topPct = sorted[0][1];

  const baseline = 100.0 / labels.length;
  const evidence = Math.sqrt(total);
  const sampleFactor = Math.min(1.0, total / minSamples);

  let confidence;
  if (total < minSamples || Math.abs(topPct - baseline) < 3) confidence = '低';
  else if (total < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
  else confidence = '高';

  const pValue = computePValueFromDist(final, total, labels);

  return {
    length, pattern, sample: total, final,
    lean: topLean, pct: topPct,
    topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({ label, pct: Math.round(pct * 100) / 100 })),
    weight: evidence * (0.35 + 0.65 * sampleFactor),
    confidence,
    pValue,
  };
}

// 频率模型（返回全部分布）
function predictFrequency(seq, labels, window = 30) {
  if (!seq || seq.length === 0) return null;
  const x = seq.slice(-window);
  const counter = {};
  for (const v of x) counter[v] = (counter[v] || 0) + 1;
  const total = x.length;

  const final = {};
  for (const lb of labels) {
    final[lb] = ((counter[lb] || 0) + 1) / (total + labels.length) * 100;
  }

  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const pValue = computePValueFromDist(final, total, labels);

  return {
    lean: sorted[0][0], pct: sorted[0][1], sample: total, final,
    topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({ label, pct: Math.round(pct * 100) / 100 })),
    confidence: total >= 30 ? '中' : '低',
    modelName: window + '期频率',
    pValue,
  };
}

// ==================== 自适应集成模型 ====================

function adaptivePatternModel(seq, labels, lengths = [3, 4, 5, 6], minSamples = null, dynamicWeights = null) {
  minSamples = minSamples || Settings.predictionMinSamples;
  const details = [];
  const lengthBonus = { 3: 0.95, 4: 1.00, 5: 1.05, 6: 1.08 };

  for (const L of lengths) {
    const m = singlePatternModel(seq, labels, L, minSamples);
    if (m) {
      m.weight *= lengthBonus[L] || 1.0;
      // 动态加权：如果提供了近期表现权重，乘上去
      if (dynamicWeights && dynamicWeights[L]) {
        m.weight *= dynamicWeights[L];
      }
      details.push(m);
    }
  }

  if (details.length === 0) {
    return { lean: '', pct: 0, sample: 0, pattern: [], details: [], confidence: '低', final: {}, topN: [] };
  }

  const scores = {};
  for (const lb of labels) scores[lb] = 0.0;
  let totalW = 0.0;

  for (const d of details) {
    const w = d.weight;
    totalW += w;
    for (const lb of labels) {
      scores[lb] += (d.final[lb] || 0) * w;
    }
  }

  const final = {};
  for (const lb of labels) {
    final[lb] = totalW > 0 ? scores[lb] / totalW : 0;
  }

  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const lean = sorted[0][0];
  const top = sorted[0][1];

  const baseline = 100 / labels.length;
  let effective = 0;
  if (totalW > 0) {
    let sumSW = 0;
    for (const d of details) sumSW += d.sample * d.weight;
    effective = sumSW / totalW;
  }

  let confidence;
  if (effective < minSamples || Math.abs(top - baseline) < 3) confidence = '低';
  else if (effective < 20 || Math.abs(top - baseline) < 7) confidence = '中';
  else confidence = '高';

  let best = details[0];
  for (const d of details) if (d.weight > best.weight) best = d;

  // v5.4 新增：计算 p 值（按权重加权融合各子模型p值）
  let pValue = 1.0;
  if (details.length > 0 && totalW > 0) {
    let sumLogP = 0;
    for (const d of details) {
      const w = d.weight || 1;
      const p = d.pValue !== undefined ? d.pValue : 1.0;
      sumLogP += w * Math.log(Math.max(p, 1e-10));
    }
    pValue = Math.exp(sumLogP / totalW);
  }

  return {
    lean, pct: Math.round(top * 100) / 100, sample: Math.round(effective * 10) / 10,
    pattern: best.pattern, patternLen: best.length, confidence,
    final: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({ label, pct: Math.round(pct * 100) / 100 })),
    details,
    pValue,
  };
}

// ==================== 组合独立预测模型 ====================
// 不再由大小×单双推导，而是直接对组合序列（大单/大双/小单/小双）做形态匹配

function predictComboDirect(seq, labels) {
  // 直接对组合序列做预测，和大小/单双完全独立
  return predictSelected(seq, labels);
}

// ==================== 位置号码预测 ====================
// 对某个位置（如冠军、亚军、第1位号码）的数字序列做多号码预测
// 返回Top N最可能出现的号码

function predictPositionNumbers(numSeq, numRange, topN = 3, modelType = 'ensemble') {
  // numSeq: 数字数组 [3, 7, 1, 10, ...]
  // numRange: 号码范围，比如 [1,2,...,10] 或 [1,2,...,80]
  const labels = numRange.map(String);
  const strSeq = numSeq.map(String);

  let model;
  if (modelType === 'ensemble') {
    model = adaptivePatternModel(strSeq, labels);
  } else if (modelType === 'frequency') {
    model = predictFrequency(strSeq, labels, 30);
  } else {
    model = singlePatternModel(strSeq, labels, 5, 6);
  }

  if (!model || !model.topN || model.topN.length === 0) {
    return { topN: [], lean: '', pct: 0, sample: 0, confidence: '低' };
  }

  // 取Top N
  const topPicks = model.topN.slice(0, Math.min(topN, model.topN.length));

  return {
    topN: topPicks.map(t => ({ number: parseInt(t.label), pct: t.pct })),
    lean: model.lean ? parseInt(model.lean) : null,
    pct: model.pct,
    sample: model.sample,
    confidence: model.confidence,
    modelName: model.selectedModel ? model.selectedModel.name : '自适应集成',
    allProbs: model.final,
  };
}

// ==================== 滚动回测 ====================

function walkForwardBacktest(seq, labels, modelName = 'ensemble', minHistory = null, length = 5, window = 30, testLimit = null) {
  minHistory = minHistory || Settings.backtestMinHistory;
  if (seq.length <= minHistory) return null;

  const start = testLimit ? Math.max(minHistory, seq.length - testLimit) : minHistory;
  const results = [];

  for (let t = start; t < seq.length; t++) {
    const train = seq.slice(0, t);
    let model = null;

    if (modelName === 'ensemble') {
      model = adaptivePatternModel(train, labels);
    } else if (modelName === 'frequency') {
      model = predictFrequency(train, labels, window);
    } else {
      model = singlePatternModel(train, labels, length, 6);
    }

    if (!model || !model.lean) continue;
    results.push(seq[t] === model.lean);
  }

  if (results.length === 0) return null;

  const n = results.length;
  const ok = results.filter(Boolean).length;
  const rate = ok / n * 100;
  const baseline = 100 / labels.length;
  const [low, high] = wilsonInterval(ok, n);

  return {
    n, ok, bad: n - ok, rate, baseline,
    low, high, advantage: rate - baseline, ciWidth: high - low,
  };
}

// TopN 回测：预测的TopN中包含实际结果就算对
function walkForwardBacktestTopN(seq, labels, topN = 3, modelName = 'ensemble', minHistory = null, length = 5, window = 30, testLimit = null) {
  minHistory = minHistory || Settings.backtestMinHistory;
  if (seq.length <= minHistory) return null;

  const start = testLimit ? Math.max(minHistory, seq.length - testLimit) : minHistory;
  const results = [];

  for (let t = start; t < seq.length; t++) {
    const train = seq.slice(0, t);
    let model = null;

    if (modelName === 'ensemble') {
      model = adaptivePatternModel(train, labels);
    } else if (modelName === 'frequency') {
      model = predictFrequency(train, labels, window);
    } else {
      model = singlePatternModel(train, labels, length, 6);
    }

    if (!model || !model.topN || model.topN.length === 0) continue;

    const actual = seq[t];
    const topLabels = model.topN.slice(0, topN).map(t => t.label);
    const hit = topLabels.includes(actual);
    results.push(hit);
  }

  if (results.length === 0) return null;

  const n = results.length;
  const ok = results.filter(Boolean).length;
  const rate = ok / n * 100;
  const baseline = topN / labels.length * 100;
  const [low, high] = wilsonInterval(ok, n);

  return {
    n, ok, bad: n - ok, rate, baseline,
    low, high, advantage: rate - baseline, ciWidth: high - low,
    topN,
  };
}

// ==================== 模型稳定性与评估 ====================

function modelStabilityScore(longBt, recentBt) {
  const longAdv = longBt.advantage;
  const recentAdv = recentBt ? recentBt.advantage : longAdv;
  const lowerAdv = longBt.low - longBt.baseline;
  const stabilityPenalty = Math.abs(longAdv - recentAdv) * 0.25;
  return 0.55 * longAdv + 0.25 * recentAdv + 0.20 * lowerAdv - stabilityPenalty;
}

function evaluateModels(seq, labels, minHistory = null) {
  minHistory = minHistory || Settings.backtestMinHistory;
  if (seq.length <= minHistory + 10) return [];

  const recentLimit = Math.min(Settings.backtestRecentLimitBase, Math.max(50, Math.floor(seq.length / 3)));
  const rows = [];
  const bonferroniN = MODEL_CANDIDATES.length;

  for (const candidate of MODEL_CANDIDATES) {
    const longBt = walkForwardBacktest(seq, labels, candidate.type, minHistory, candidate.length, candidate.window, null);
    const recentBt = walkForwardBacktest(seq, labels, candidate.type, minHistory, candidate.length, candidate.window, recentLimit);

    if (!longBt) continue;

    const score = modelStabilityScore(longBt, recentBt);
    const { significant, pValue } = binomialSignificance(
      longBt.ok, longBt.n, 1 / labels.length,
      Settings.bonferroniCorrection ? bonferroniN : 1
    );

    rows.push({
      模型: candidate.name, type: candidate.type, length: candidate.length, window: candidate.window,
      长期样本: longBt.n, 长期准确率: longBt.rate, 长期优势: longBt.advantage,
      长期下界: longBt.low, 长期上界: longBt.high,
      长期显著: significant, 长期p值: pValue,
      近期样本: recentBt ? recentBt.n : 0,
      近期准确率: recentBt ? recentBt.rate : 0,
      近期优势: recentBt ? recentBt.advantage : 0,
      综合分: score,
    });
  }

  return rows;
}

// 计算动态权重（根据近期各长度模型的表现）
function computeDynamicWeights(seq, labels, lengths = [3, 4, 5, 6], recentWindow = 50) {
  const weights = {};
  for (const L of lengths) {
    const bt = walkForwardBacktest(seq, labels, 'fixed', 20, L, 0, recentWindow);
    if (bt && bt.n > 10) {
      // 以基准线为底，优势越大权重越高
      const adv = Math.max(0, bt.rate - bt.baseline);
      weights[L] = 1.0 + adv / 10; // 1.0 ~ 2.0 左右
    } else {
      weights[L] = 1.0;
    }
  }
  return weights;
}

function selectModel(seq, labels, minHistory = null) {
  minHistory = minHistory || Settings.backtestMinHistory;
  const rows = evaluateModels(seq, labels, minHistory);

  if (rows.length === 0) {
    return { name: '3/4/5/6集成', type: 'ensemble', length: 0, window: 0, score: 0, reason: '样本不足，使用保守集成' };
  }

  let eligible = rows.filter(r => r['长期样本'] >= Settings.backtestLongMinSamples);
  if (eligible.length === 0) eligible = rows;

  let best = eligible[0];
  for (const r of eligible) if (r['综合分'] > best['综合分']) best = r;

  const baseline = 100.0 / labels.length;

  if (best['长期下界'] <= baseline && !best['长期显著']) {
    return {
      name: '3/4/5/6集成', type: 'ensemble', length: 0, window: 0,
      score: best['综合分'], longRate: best['长期准确率'],
      recentRate: best['近期准确率'],
      reason: '无显著统计优势，回退综合集成',
      pValue: best['长期p值'] || 1.0,
    };
  }

  return {
    name: best['模型'], type: best.type, length: best.length,
    window: best.window, score: best['综合分'],
    longRate: best['长期准确率'], recentRate: best['近期准确率'],
    reason: '长期+近期表现综合选择',
    significant: best['长期显著'] || false,
    pValue: best['长期p值'] || 1.0,
  };
}

// 使用选中模型生成预测（返回完整分布+TopN）
function predictSelected(seq, labels) {
  const choice = selectModel(seq, labels);
  const typ = choice.type;
  let model;

  if (typ === 'ensemble') {
    // 使用动态加权
    const dynWeights = computeDynamicWeights(seq, labels);
    model = adaptivePatternModel(seq, labels, [3, 4, 5, 6], null, dynWeights);
  } else if (typ === 'frequency') {
    const freq = predictFrequency(seq, labels, choice.window);
    if (freq) {
      model = {
        lean: freq.lean, pct: freq.pct, sample: freq.sample,
        final: freq.final, confidence: freq.confidence,
        topN: freq.topN || [],
        pattern: [], patternLen: 0, details: [],
      };
    } else {
      model = { lean: '', pct: 0, sample: 0, final: {}, confidence: '低', pattern: [], topN: [], details: [] };
    }
  } else {
    const fixed = singlePatternModel(seq, labels, choice.length, 6);
    if (fixed) {
      model = {
        lean: fixed.lean, pct: fixed.pct, sample: fixed.sample,
        pattern: fixed.pattern, patternLen: fixed.length,
        final: fixed.final, confidence: fixed.confidence,
        topN: fixed.topN || [],
        details: [],
      };
    } else {
      model = { lean: '', pct: 0, sample: 0, final: {}, confidence: '低', pattern: [], topN: [], details: [] };
    }
  }

  model.selectedModel = choice;
  return model;
}

// ==================== 连对连错统计 ====================

function computeStreaks(records, category = null) {
  let rows = records.filter(r => r.result === '对' || r.result === '错');
  if (category && category !== '全部') rows = rows.filter(r => r.category === category);
  if (rows.length === 0) return { currentStreak: 0, currentType: '-', maxWinStreak: 0, maxLoseStreak: 0, last10: [] };

  // 近期10期
  const last10 = rows.slice(0, 10).map(r => r.result);

  let currentStreak = 1;
  let currentType = rows[0].result;
  let maxWinStreak = 0;
  let maxLoseStreak = 0;
  let tempStreak = 1;
  let tempType = rows[0].result;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i].result === tempType) {
      tempStreak++;
    } else {
      if (tempType === '对' && tempStreak > maxWinStreak) maxWinStreak = tempStreak;
      if (tempType === '错' && tempStreak > maxLoseStreak) maxLoseStreak = tempStreak;
      tempStreak = 1;
      tempType = rows[i].result;
    }
  }
  // 最后一段
  if (tempType === '对' && tempStreak > maxWinStreak) maxWinStreak = tempStreak;
  if (tempType === '错' && tempStreak > maxLoseStreak) maxLoseStreak = tempStreak;

  // 当前连对/连错
  const currentResult = rows[0].result;
  let streakCount = 1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].result === currentResult) streakCount++;
    else break;
  }

  return {
    currentStreak: streakCount,
    currentType: currentResult === '对' ? '连对' : '连错',
    maxWinStreak,
    maxLoseStreak,
    last10,
  };
}

// ==================== 模型追踪 ====================

function modelTrackingSummary(records, category = null, window = 300) {
  let rows = records.slice(0, window);
  if (category && category !== '全部') rows = rows.filter(r => r.category === category);
  rows = rows.filter(r => r.result === '对' || r.result === '错');

  const groups = {};
  for (const r of rows) {
    if (!groups[r.modelName]) groups[r.modelName] = { n: 0, ok: 0 };
    groups[r.modelName].n++;
    if (r.result === '对') groups[r.modelName].ok++;
  }

  const base = category === '组合' ? 25.0 : 50.0;
  const out = [];

  for (const name in groups) {
    const g = groups[name];
    const { n, ok } = g;
    const rate = n > 0 ? ok / n * 100 : 0;
    const [low, high] = n > 0 ? wilsonInterval(ok, n) : [0, 100];

    const modelRows = rows.filter(r => r.modelName === name);
    const recent = modelRows.slice(0, Math.min(50, modelRows.length));
    const rok = recent.filter(r => r.result === '对').length;
    const rn = recent.length;
    const recentRate = rn > 0 ? rok / rn * 100 : 0;

    out.push({
      模型: name, 样本: n, 正确: ok, 准确率: rate,
      下界: low, 上界: high, 近期样本: rn, 近期准确率: recentRate,
      相对基准: rate - base,
      状态: low > base ? '稳定优势' : (rate >= base ? '观察' : '低于基准')
    });
  }

  return out.sort((a, b) => b.准确率 - a.准确率 || b.样本 - a.样本);
}

// ==================== v4 新增：窗口化工具 ====================

/**
 * 获取预测用的窗口化数据（最近 N 期）
 * 如果 predictionWindow <= 0 或数据不足，返回原序列
 */
function getWindowedSeq(seq, windowSize = null) {
  if (!seq || seq.length === 0) return seq;
  const w = windowSize !== null ? windowSize : Settings.predictionWindow;
  if (w <= 0 || seq.length <= w) return seq;
  return seq.slice(seq.length - w);
}

// ==================== v4 新增：和值区间交叉特征模型 ====================

/**
 * 将和值离散化为区间
 * sumValue: 和值（数字）
 * sumMin, sumMax: 和值范围
 * nRanges: 区间数量（默认5）
 * 返回: 区间标签，如 '低'/'偏低'/'中'/'偏高'/'高'
 */
function getSumRange(sumValue, sumMin, sumMax, nRanges = 5) {
  const rangeLabels = ['低', '偏低', '中', '偏高', '高'];
  if (sumMin === sumMax) return '中';
  const step = (sumMax - sumMin) / nRanges;
  let idx = Math.floor((sumValue - sumMin) / step);
  idx = Math.max(0, Math.min(nRanges - 1, idx));
  return rangeLabels[idx] || '中';
}

/**
 * 生成交叉特征序列（和值区间 + 类别标签）
 * seq: 类别序列（如 ['大单', '小双', ...]）
 * sumSeq: 和值数字序列
 * sumMin, sumMax: 和值范围
 */
function buildCrossSequence(seq, sumSeq, sumMin, sumMax) {
  if (!seq || !sumSeq || seq.length !== sumSeq.length) return [];
  const cross = [];
  for (let i = 0; i < seq.length; i++) {
    const range = getSumRange(sumSeq[i], sumMin, sumMax);
    cross.push(`${range}-${seq[i]}`);
  }
  return cross;
}

/**
 * 交叉特征模型（和值区间 + 组合）
 * 返回与 singlePatternModel 兼容的格式
 */
function crossFeatureModel(seq, sumSeq, labels, sumMin, sumMax, length = 2, minSamples = null) {
  minSamples = minSamples || Settings.zuheMinSamples;
  if (seq.length <= length || sumSeq.length !== seq.length) return null;

  const crossSeq = buildCrossSequence(seq, sumSeq, sumMin, sumMax);
  const crossLabels = [];
  const ranges = ['低', '偏低', '中', '偏高', '高'];
  for (const r of ranges) {
    for (const lb of labels) {
      crossLabels.push(`${r}-${lb}`);
    }
  }

  const pattern = crossSeq.slice(-length);
  const r = patternStats(crossSeq, pattern, Settings.predictionAlpha);
  const total = r.total || 0;
  if (total <= 0) return null;

  // 将交叉概率汇总回原标签维度
  const aggregated = {};
  for (const lb of labels) aggregated[lb] = 0;

  for (const crossKey in r.smoothPct) {
    const parts = crossKey.split('-');
    if (parts.length < 2) continue;
    const lb = parts.slice(1).join('-'); // 处理标签本身可能含"-"的情况
    if (aggregated[lb] !== undefined) {
      aggregated[lb] += r.smoothPct[crossKey];
    }
  }

  // 重新归一化到 100%
  const totalPct = Object.values(aggregated).reduce((a, b) => a + b, 0);
  const final = {};
  for (const lb of labels) {
    final[lb] = totalPct > 0 ? aggregated[lb] / totalPct * 100 : 100 / labels.length;
  }

  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const baseline = 100.0 / labels.length;
  const evidence = Math.sqrt(total);
  const sampleFactor = Math.min(1.0, total / minSamples);

  let confidence;
  const topPct = sorted[0][1];
  if (total < minSamples || Math.abs(topPct - baseline) < 3) confidence = '低';
  else if (total < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
  else confidence = '高';

  return {
    length, pattern, sample: total, final,
    lean: sorted[0][0], pct: topPct,
    topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({ label, pct: Math.round(pct * 100) / 100 })),
    weight: evidence * (0.35 + 0.65 * sampleFactor),
    confidence,
    modelName: '和值交叉',
    isCrossFeature: true,
  };
}

// ==================== v4 新增：组合预测增强版（6项措施） ====================

/**
 * 增强版组合预测
 * 集成：短形态模型 + 缩短频率窗口 + 超短窗口 + 交叉特征 + EWMA加权
 * @param {Array} seq - 组合序列
 * @param {Array} sumSeq - 和值序列（可选，用于交叉特征）
 * @param {Array} labels - 标签列表
 * @param {Object} options - { sumMin, sumMax, ewmaScores, topN }
 */
function predictZuheEnhanced(seq, sumSeq, labels, options = {}) {
  const {
    sumMin = 3,
    sumMax = 19,
    ewmaScores = null,
    topN = 3,
  } = options;

  // v4.2 新增：获取灵敏度模式参数
  const sensParams = getSensitivityParams();
  const effectiveWindow = sensParams.predictionWindow;

  // 使用灵敏度调整后的窗口
  const wSeq = getWindowedSeq(seq, effectiveWindow);
  const wSum = sumSeq ? getWindowedSeq(sumSeq, effectiveWindow) : null;

  const models = [];

  // 1. 短形态模型（2期、3期）
  const patternLengths = Settings.zuhePatternLengths || [2, 3];
  for (const L of patternLengths) {
    const m = singlePatternModel(wSeq, labels, L, Settings.zuheMinSamples);
    if (m) {
      m.modelName = `${L}期形态`;
      models.push(m);
    }
  }

  // 2. 频率模型（短窗口）
  const freqWindows = Settings.zuheFreqWindows || [10, 15];
  for (const w of freqWindows) {
    const m = predictFrequency(wSeq, labels, w);
    if (m) {
      m.modelName = `${w}期频率`;
      m.weight = Math.sqrt(m.sample) * 0.8; // 频率模型权重稍低
      models.push(m);
    }
  }

  // 3. 超短窗口频率
  const ultraWindows = Settings.zuheUltraShortWindows || [5, 8];
  for (const w of ultraWindows) {
    const m = predictFrequency(wSeq, labels, w);
    if (m) {
      m.modelName = `${w}期超短`;
      m.weight = Math.sqrt(m.sample) * 0.6; // 超短窗口权重更低
      models.push(m);
    }
  }

  // 4. 和值交叉特征（如果有和值数据）
  if (Settings.zuheCrossFeature && wSum && wSum.length === wSeq.length) {
    const crossM = crossFeatureModel(wSeq, wSum, labels, sumMin, sumMax, 2, Settings.zuheMinSamples);
    if (crossM) {
      crossM.weight *= 0.9; // 交叉特征权重略低
      models.push(crossM);
    }
  }

  if (models.length === 0) {
    return { lean: '', pct: 0, sample: 0, final: {}, topN: [], confidence: '低', details: [] };
  }

  // 5. EWMA 加权（使用灵敏度调整后的温度）
  if (ewmaScores && Object.keys(ewmaScores).length > 0) {
    for (const m of models) {
      const score = ewmaScores[m.modelName];
      if (score !== undefined) {
        const temperature = sensParams.ewmaTemp;
        const multiplier = Math.exp((score - 0.5) / temperature);
        m.weight *= multiplier;
      }
    }
  }

  // 6. 冷热趋势增强
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

  // 7. v4.2 新增：超短窗口增强
  applyUltraShortBoost(models, sensParams.ultraShortBoost);

  // 8. v4.2 新增：动量加权
  if (sensParams.momentumStrength > 0) {
    // 为组合预测构造临时候选列表用于动量计算
    const tempCandidates = [];
    for (const L of patternLengths) {
      tempCandidates.push({ name: `${L}期形态`, type: 'fixed', length: L, window: 0 });
    }
    for (const w of freqWindows) {
      tempCandidates.push({ name: `${w}期频率`, type: 'frequency', length: 0, window: w });
    }
    for (const w of ultraWindows) {
      tempCandidates.push({ name: `${w}期超短`, type: 'frequency', length: 0, window: w });
    }
    const momentum = computeModelMomentum(seq, labels, tempCandidates, Settings.momentumWindow || 10);
    applyMomentumWeights(models, momentum, sensParams.momentumStrength);
  }

  // 9. v4.2 新增：反同质化加权
  applyAntiHerdWeights(models, sensParams.antiHerdStrength);

  // 10. 加权融合
  const scores = {};
  for (const lb of labels) scores[lb] = 0.0;
  let totalW = 0.0;

  for (const m of models) {
    const w = m.weight || 1;
    totalW += w;
    for (const lb of labels) {
      scores[lb] += (m.final[lb] || 0) * w;
    }
  }

  let final = {};
  for (const lb of labels) {
    final[lb] = totalW > 0 ? scores[lb] / totalW : 0;
  }

  // 11. v4.2 新增：连续相同衰减
  if (sensParams.streakDecayEnabled) {
    const tempCandidates = [];
    for (const L of patternLengths) {
      tempCandidates.push({ name: `${L}期形态`, type: 'fixed', length: L, window: 0 });
    }
    const streakInfo = computePredictionStreak(seq, labels, tempCandidates, Settings.streakDecayMaxPeriods || 5);
    final = applyStreakDecay(final, labels, streakInfo, sensParams.streakDecayRate, Settings.streakDecayMaxPeriods || 5);
  }

  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const lean = sorted[0][0];
  const topPct = sorted[0][1];

  const baseline = 100 / labels.length;
  let effective = 0;
  if (totalW > 0) {
    let sumSW = 0;
    for (const m of models) sumSW += (m.sample || 0) * (m.weight || 1);
    effective = sumSW / totalW;
  }

  let confidence;
  if (effective < Settings.zuheMinSamples || Math.abs(topPct - baseline) < 3) confidence = '低';
  else if (effective < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
  else confidence = '高';

  const topNList = sorted.slice(0, Math.min(topN, sorted.length)).map(([label, pct]) => ({
    label,
    pct: Math.round(pct * 100) / 100
  }));

  // v5.4 新增：计算 p 值
  const pValue = computePValueFromDist(final, effective, labels);

  return {
    lean,
    pct: Math.round(topPct * 100) / 100,
    sample: Math.round(effective * 10) / 10,
    final: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    topN: topNList,
    confidence,
    pValue,
    details: models.map(m => ({
      name: m.modelName || '未知',
      lean: m.lean,
      pct: m.pct,
      sample: m.sample,
      weight: Math.round((m.weight || 0) * 100) / 100,
      confidence: m.confidence,
    })),
    selectedModel: { name: '组合增强模型', type: 'zuhe_enhanced', isEnhanced: true },
  };
}

// ==================== v4 新增：EWMA 加权通用预测 ====================

/**
 * 使用 EWMA 评分做加权集成预测
 * 适用于大小、单双等二分类
 */
function predictWithEWMA(seq, labels, ewmaScores, modelCandidates = null) {
  const candidates = modelCandidates || MODEL_CANDIDATES;

  // v4.2 新增：获取灵敏度模式参数
  const sensParams = getSensitivityParams();
  const effectiveWindow = sensParams.predictionWindow;

  // 使用灵敏度调整后的窗口
  const wSeq = getWindowedSeq(seq, effectiveWindow);
  const models = [];

  for (const cand of candidates) {
    let m = null;
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
      // 集成模型作为单个模型参与（但EWMA对其也评分）
      const dynWeights = computeDynamicWeights(wSeq, labels);
      m = adaptivePatternModel(wSeq, labels, [3, 4, 5, 6], null, dynWeights);
      if (m) m.modelName = cand.name;
    }

    if (m) models.push(m);
  }

  if (models.length === 0) {
    return { lean: '', pct: 0, sample: 0, final: {}, topN: [], confidence: '低', details: [] };
  }

  // 1. 应用 EWMA 权重（使用灵敏度调整后的温度）
  for (const m of models) {
    const score = ewmaScores[m.modelName];
    if (score !== undefined) {
      const temperature = sensParams.ewmaTemp;
      const multiplier = Math.exp((score - 0.5) / temperature);
      m.weight = (m.weight || 1) * multiplier;
    }
  }

  // 2. 冷热趋势增强
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

  // 3. v4.2 新增：超短窗口增强
  applyUltraShortBoost(models, sensParams.ultraShortBoost);

  // 4. v4.2 新增：动量加权（近期表现上升的模型权重更高）
  if (sensParams.momentumStrength > 0) {
    const momentum = computeModelMomentum(seq, labels, candidates, Settings.momentumWindow || 10);
    applyMomentumWeights(models, momentum, sensParams.momentumStrength);
  }

  // 5. v4.2 新增：反同质化加权（降低随大流模型权重）
  applyAntiHerdWeights(models, sensParams.antiHerdStrength);

  // 加权融合
  const scores = {};
  for (const lb of labels) scores[lb] = 0.0;
  let totalW = 0.0;

  for (const m of models) {
    const w = m.weight || 1;
    totalW += w;
    for (const lb of labels) {
      scores[lb] += (m.final[lb] || 0) * w;
    }
  }

  let final = {};
  for (const lb of labels) {
    final[lb] = totalW > 0 ? scores[lb] / totalW : 0;
  }

  // 6. v4.2 新增：连续相同衰减
  if (sensParams.streakDecayEnabled) {
    const streakInfo = computePredictionStreak(seq, labels, candidates, Settings.streakDecayMaxPeriods || 5);
    final = applyStreakDecay(final, labels, streakInfo, sensParams.streakDecayRate, Settings.streakDecayMaxPeriods || 5);
  }

  const sorted = Object.entries(final).sort((a, b) => b[1] - a[1]);
  const lean = sorted[0][0];
  const topPct = sorted[0][1];

  const baseline = 100 / labels.length;
  let effective = 0;
  if (totalW > 0) {
    let sumSW = 0;
    for (const m of models) sumSW += (m.sample || 0) * (m.weight || 1);
    effective = sumSW / totalW;
  }

  let confidence;
  if (effective < Settings.predictionMinSamples || Math.abs(topPct - baseline) < 3) confidence = '低';
  else if (effective < 20 || Math.abs(topPct - baseline) < 7) confidence = '中';
  else confidence = '高';

  // v5.4 新增：计算 p 值
  const pValue = computePValueFromDist(final, effective, labels);

  return {
    lean,
    pct: Math.round(topPct * 100) / 100,
    sample: Math.round(effective * 10) / 10,
    final: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    topN: sorted.slice(0, Math.min(5, sorted.length)).map(([label, pct]) => ({ label, pct: Math.round(pct * 100) / 100 })),
    confidence,
    pValue,
    details: models.map(m => ({
      name: m.modelName || '未知',
      lean: m.lean,
      pct: m.pct,
      sample: m.sample,
      weight: Math.round((m.weight || 0) * 100) / 100,
      ewmaScore: ewmaScores[m.modelName] ? Math.round(ewmaScores[m.modelName] * 1000) / 10 : null,
    })),
    selectedModel: { name: 'EWMA加权集成', type: 'ewma_ensemble', isEwma: true },
  };
}

// ==================== v4 新增：位置预测增强版 ====================

/**
 * 增强版位置号码预测
 * 支持可调 TopN + 窗口化 + 多模型融合
 */
function predictPositionEnhanced(numSeq, numRange, options = {}) {
  const {
    topN = 3,
    ewmaScores = null,
    modelType = 'ensemble',
  } = options;

  const labels = numRange.map(String);
  const strSeq = numSeq.map(String);

  // v4.2 新增：获取灵敏度模式参数，调整窗口
  const sensParams = getSensitivityParams();
  const wSeq = getWindowedSeq(strSeq, sensParams.predictionWindow);

  let model;

  if (Settings.ewmaEnabled && ewmaScores && Object.keys(ewmaScores).length > 0) {
    // EWMA 加权模式
    model = predictWithEWMA(wSeq, labels, ewmaScores, MODEL_CANDIDATES);
  } else if (modelType === 'ensemble') {
    const dynWeights = computeDynamicWeights(wSeq, labels);
    model = adaptivePatternModel(wSeq, labels, [3, 4, 5, 6], null, dynWeights);
  } else if (modelType === 'frequency') {
    model = predictFrequency(wSeq, labels, 30);
  } else {
    model = singlePatternModel(wSeq, labels, 5, 6);
  }

  if (!model || !model.topN || model.topN.length === 0) {
    return { topN: [], lean: '', pct: 0, sample: 0, confidence: '低', details: [] };
  }

  const topPicks = model.topN.slice(0, Math.min(topN, model.topN.length));

  return {
    topN: topPicks.map(t => ({ number: parseInt(t.label), pct: t.pct })),
    lean: model.lean ? parseInt(model.lean) : null,
    pct: model.pct,
    sample: model.sample,
    confidence: model.confidence,
    details: model.details || [],
    selectedModel: model.selectedModel || { name: '自适应集成', type: 'ensemble' },
    allProbs: model.final,
  };
}

// ==================== v4 新增：各模型单独预测（用于EWMA结算） ====================

/**
 * 获取所有候选模型的单独预测结果
 * 用于开奖后结算各模型对错，更新 EWMA 评分
 * @param {Array} seq - 历史序列（不含最新一期）
 * @param {Array} labels - 标签列表
 * @param {Array} candidates - 模型候选列表
 * @returns {Object} { modelName: predictedLabel }
 */
function getAllModelPredictions(seq, labels, candidates = null) {
  candidates = candidates || MODEL_CANDIDATES;
  const wSeq = getWindowedSeq(seq);
  const results = {};

  for (const cand of candidates) {
    let pred = null;
    try {
      if (cand.type === 'fixed') {
        const m = singlePatternModel(wSeq, labels, cand.length, Settings.predictionMinSamples);
        if (m) pred = m.lean;
      } else if (cand.type === 'frequency') {
        const m = predictFrequency(wSeq, labels, cand.window);
        if (m) pred = m.lean;
      } else if (cand.type === 'ensemble') {
        const dynWeights = computeDynamicWeights(wSeq, labels);
        const m = adaptivePatternModel(wSeq, labels, [3, 4, 5, 6], null, dynWeights);
        if (m) pred = m.lean;
      }
    } catch (e) {
      // 忽略单个模型的错误
    }
    if (pred) results[cand.name] = pred;
  }

  return results;
}

/**
 * 获取组合预测各模型的单独预测结果
 */
function getZuheModelPredictions(seq, sumSeq, labels, sumMin, sumMax) {
  const wSeq = getWindowedSeq(seq);
  const wSum = sumSeq ? getWindowedSeq(sumSeq) : null;
  const results = {};

  // 短形态
  for (const L of (Settings.zuhePatternLengths || [2, 3])) {
    const m = singlePatternModel(wSeq, labels, L, Settings.zuheMinSamples);
    if (m) results[`${L}期形态`] = m.lean;
  }
  // 频率
  for (const w of (Settings.zuheFreqWindows || [10, 15])) {
    const m = predictFrequency(wSeq, labels, w);
    if (m) results[`${w}期频率`] = m.lean;
  }
  // 超短
  for (const w of (Settings.zuheUltraShortWindows || [5, 10])) {
    const m = predictFrequency(wSeq, labels, w);
    if (m) results[`${w}期超短`] = m.lean;
  }
  // 交叉特征
  if (Settings.zuheCrossFeature && wSum && wSum.length === wSeq.length) {
    const m = crossFeatureModel(wSeq, wSum, labels, sumMin, sumMax, 2, Settings.zuheMinSamples);
    if (m) results['和值交叉'] = m.lean;
  }

  return results;
}

// ==================== v4.2 新增：动量加权 ====================

/**
 * 计算各模型的近期动量（最近N期表现趋势）
 * 返回 { modelName: momentumScore }，分数越高表示近期上升势头越强
 */
function computeModelMomentum(seq, labels, modelCandidates, recentWindow = 10) {
  const momentum = {};
  if (seq.length < recentWindow + 10) return momentum; // 数据不足

  // 性能优化：限制最大候选模型数和窗口大小
  const maxCandidates = 5;
  const candidates = modelCandidates.slice(0, maxCandidates);
  const effectiveWindow = Math.min(recentWindow, 10); // 最多10期，避免计算过慢

  const halfWindow = Math.floor(effectiveWindow / 2);
  const startIdx = Math.max(0, seq.length - effectiveWindow);

  for (const cand of candidates) {
    // 计算前半段和后半段的准确率差异
    const firstHalfStart = Math.max(0, startIdx - halfWindow);
    const secondHalfStart = startIdx + halfWindow;

    let firstOk = 0, firstN = 0;
    let secondOk = 0, secondN = 0;

    // 前半段（间隔采样，减少计算）
    for (let t = firstHalfStart; t < startIdx + halfWindow && t < seq.length - 1; t += 2) {
      const train = seq.slice(0, t);
      let pred = null;
      try {
        if (cand.type === 'fixed') {
          const m = singlePatternModel(train, labels, cand.length, Settings.predictionMinSamples);
          if (m) pred = m.lean;
        } else if (cand.type === 'frequency') {
          const m = predictFrequency(train, labels, cand.window);
          if (m) pred = m.lean;
        } else if (cand.type === 'ensemble') {
          const m = adaptivePatternModel(train, labels);
          if (m) pred = m.lean;
        }
      } catch (e) { continue; }
      if (pred) {
        firstN++;
        if (seq[t + 1] === pred) firstOk++;
      }
    }

    // 后半段（间隔采样，减少计算）
    for (let t = secondHalfStart; t < seq.length - 1; t += 2) {
      const train = seq.slice(0, t);
      let pred = null;
      try {
        if (cand.type === 'fixed') {
          const m = singlePatternModel(train, labels, cand.length, Settings.predictionMinSamples);
          if (m) pred = m.lean;
        } else if (cand.type === 'frequency') {
          const m = predictFrequency(train, labels, cand.window);
          if (m) pred = m.lean;
        } else if (cand.type === 'ensemble') {
          const m = adaptivePatternModel(train, labels);
          if (m) pred = m.lean;
        }
      } catch (e) { continue; }
      if (pred) {
        secondN++;
        if (seq[t + 1] === pred) secondOk++;
      }
    }

    const firstRate = firstN > 0 ? firstOk / firstN : 0.5;
    const secondRate = secondN > 0 ? secondOk / secondN : 0.5;
    // 动量 = 后半段 - 前半段（上升为正），范围约 -0.5 ~ 0.5
    momentum[cand.name] = secondRate - firstRate;
  }

  return momentum;
}

/**
 * 应用动量加权到模型列表
 * 近期表现上升的模型获得额外权重
 */
function applyMomentumWeights(models, momentum, strength = 0.5) {
  if (!momentum || Object.keys(momentum).length === 0) return;
  if (strength <= 0) return;

  for (const m of models) {
    const mom = momentum[m.modelName];
    if (mom !== undefined) {
      // 动量为正 → 权重增加；动量为负 → 权重减少
      // strength 控制影响幅度
      const boost = 1 + mom * strength * 3; // 最大约 ±1.5 倍
      m.weight = (m.weight || 1) * Math.max(0.3, boost);
    }
  }
}

// ==================== v4.2 新增：反同质化加权 ====================

/**
 * 计算模型间的预测相似度，降低"随大流"模型的权重
 * 鼓励不同观点的模型，让预测更容易变化
 */
function applyAntiHerdWeights(models, strength = 0.3) {
  if (models.length < 3 || strength <= 0) return;

  // 收集每个模型的倾向
  const leans = models.map(m => m.lean);
  const leanCount = {};
  for (const l of leans) {
    leanCount[l] = (leanCount[l] || 0) + 1;
  }

  // 多数派观点的模型数量
  const maxCount = Math.max(...Object.values(leanCount));
  const total = models.length;

  for (const m of models) {
    const sameLeanCount = leanCount[m.lean] || 1;
    // 少数派权重提升，多数派权重降低
    // 极端情况：1个模型持不同观点 → 权重提升 1+strength
    //          所有模型一致 → 权重降低 1-strength*(total-1)/total
    const herdFactor = (sameLeanCount - 1) / Math.max(1, total - 1);
    const multiplier = 1 + strength * (0.5 - herdFactor) * 2;
    m.weight = (m.weight || 1) * Math.max(0.3, multiplier);
  }
}

// ==================== v4.2 新增：连续相同衰减 ====================

/**
 * 计算预测连续相同的期数
 * 返回连续相同的次数和当前倾向
 */
function computePredictionStreak(seq, labels, modelCandidates, maxCheck = 10) {
  if (seq.length < 5) return { streak: 0, lean: null };

  let streak = 0;
  let lastLean = null;

  for (let i = 1; i <= Math.min(maxCheck, seq.length - 5); i++) {
    const histSeq = seq.slice(0, seq.length - i);
    let currentLean = null;

    // 用集成模型模拟历史预测
    try {
      const dynWeights = computeDynamicWeights(histSeq, labels);
      const m = adaptivePatternModel(histSeq, labels, [3, 4, 5, 6], null, dynWeights);
      if (m && m.lean) currentLean = m.lean;
    } catch (e) { continue; }

    if (!currentLean) break;

    if (lastLean === null) {
      lastLean = currentLean;
      streak = 1;
    } else if (currentLean === lastLean) {
      streak++;
    } else {
      break;
    }
  }

  return { streak, lean: lastLean };
}

/**
 * 应用连续相同衰减
 * 当预测连续N期相同时，降低该倾向的概率权重
 */
function applyStreakDecay(finalProbs, labels, streakInfo, decayRate = 0.15, maxPeriods = 5) {
  if (!streakInfo || streakInfo.streak < 2) return finalProbs;
  if (decayRate <= 0) return finalProbs;

  const { streak, lean } = streakInfo;
  if (!lean) return finalProbs;

  const effectiveStreak = Math.min(streak, maxPeriods);
  const decayFactor = 1 - decayRate * (effectiveStreak - 1); // 第2期开始衰减

  if (decayFactor >= 1) return finalProbs;

  const result = { ...finalProbs };
  const leanProb = result[lean] || 0;
  const reduced = leanProb * decayFactor;
  const diff = leanProb - reduced;

  result[lean] = reduced;

  // 将减少的部分平均分给其他标签
  const otherLabels = labels.filter(l => l !== lean);
  if (otherLabels.length > 0) {
    const addEach = diff / otherLabels.length;
    for (const l of otherLabels) {
      result[l] = (result[l] || 0) + addEach;
    }
  }

  return result;
}

// ==================== v4.2 新增：灵敏度模式应用 ====================

/**
 * 根据灵敏度模式调整各项参数
 * 返回调整后的参数对象
 */
function getSensitivityParams() {
  const mode = Settings.sensitivityMode || 'balanced';
  const base = {
    ewmaTemp: Settings.ewmaWeightTemperature || 0.08,
    momentumStrength: Settings.momentumStrength || 0,
    antiHerdStrength: Settings.antiHerdStrength || 0,
    streakDecayEnabled: Settings.streakDecayEnabled,
    streakDecayRate: Settings.streakDecayRate || 0.15,
    ultraShortBoost: 1.0,
    predictionWindow: Settings.predictionWindow || 100,
  };

  if (mode === 'aggressive') {
    // 灵敏模式：参数更激进
    return {
      ...base,
      ewmaTemp: Math.min(0.15, base.ewmaTemp * 1.3), // 锐度更高
      momentumStrength: Math.min(1.0, base.momentumStrength * 1.5 + 0.2),
      antiHerdStrength: Math.min(1.0, base.antiHerdStrength * 1.5 + 0.1),
      streakDecayEnabled: true,
      streakDecayRate: Math.min(0.4, base.streakDecayRate * 1.5),
      ultraShortBoost: Settings.ultraShortBoost || 2.0,
      predictionWindow: Math.max(30, Math.floor(base.predictionWindow * 0.7)), // 窗口更小
    };
  } else if (mode === 'stable') {
    // 稳定模式：参数更保守
    return {
      ...base,
      ewmaTemp: base.ewmaTemp * 1.5, // 锐度更低
      momentumStrength: base.momentumStrength * 0.3,
      antiHerdStrength: base.antiHerdStrength * 0.2,
      streakDecayEnabled: false,
      ultraShortBoost: 1.0,
      predictionWindow: Math.floor(base.predictionWindow * 1.3),
    };
  }

  return base; // balanced
}

// ==================== v4.2 新增：超短窗口增强 ====================

function applyUltraShortBoost(models, boost = 1.0) {
  if (boost <= 1.0) return;

  for (const m of models) {
    if (m.modelName && m.modelName.includes('期超短')) {
      m.weight = (m.weight || 1) * boost;
    }
    if (m.modelName && m.modelName.includes('期频率')) {
      const wMatch = m.modelName.match(/(\d+)期频率/);
      if (wMatch && parseInt(wMatch[1]) <= 10) {
        m.weight = (m.weight || 1) * boost * 0.8;
      }
    }
  }
}

// ==================== v5.0 新增：增强置信度分级 ====================

/**
 * 增强版置信度计算
 * 综合考虑：概率优势、样本量、模型一致性、历史表现
 * 返回 { level, score, label, recommend }
 */
function computeEnhancedConfidence(finalProbs, labels, options = {}) {
  const {
    sampleSize = 0,
    modelAgreement = 1, // 模型一致性：0-1，越高表示越多模型观点一致
    historicalRate = null, // 历史命中率
    category = 'binary', // binary(二分类) / quaternary(四分类)
  } = options;

  const baseline = 100 / labels.length;
  const sorted = Object.entries(finalProbs).sort((a, b) => b[1] - a[1]);
  const topPct = sorted[0][1];
  const secondPct = sorted[1]?.[1] || 0;
  const advantage = topPct - baseline;
  const gap = topPct - secondPct; // 第一名和第二名的差距

  // 计算各维度得分（0-100）
  // 1. 概率优势分
  const maxAdvantage = 100 - baseline;
  const advantageScore = maxAdvantage > 0 ? Math.min(100, (advantage / maxAdvantage) * 100) : 0;

  // 2. 样本量分
  const minSamples = category === 'quaternary' ? 10 : 20;
  const goodSamples = category === 'quaternary' ? 50 : 100;
  let sampleScore = 0;
  if (sampleSize >= goodSamples) sampleScore = 100;
  else if (sampleSize >= minSamples) sampleScore = (sampleSize - minSamples) / (goodSamples - minSamples) * 100;
  else sampleScore = sampleSize / minSamples * 30; // 低于最小样本量，最多30分

  // 3. 模型一致性分
  const agreementScore = modelAgreement * 100;

  // 4. 历史表现分（如果有）
  const historyScore = historicalRate !== null
    ? Math.max(0, (historicalRate - baseline) / (100 - baseline) * 100)
    : 50; // 没有历史数据时给中间分

  // 加权综合
  const weights = {
    advantage: 0.35,
    sample: 0.25,
    agreement: 0.20,
    history: 0.20,
  };

  const totalScore =
    advantageScore * weights.advantage +
    sampleScore * weights.sample +
    agreementScore * weights.agreement +
    historyScore * weights.history;

  // 分级
  let level, label, recommend;
  if (totalScore >= 75) {
    level = 'strong';
    label = '强烈推荐';
    recommend = '预测高度一致，建议重点关注';
  } else if (totalScore >= 55) {
    level = 'high';
    label = '推荐';
    recommend = '预测倾向明显，可以参考';
  } else if (totalScore >= 35) {
    level = 'medium';
    label = '一般';
    recommend = '预测倾向一般，谨慎参考';
  } else if (totalScore >= 20) {
    level = 'low';
    label = '偏弱';
    recommend = '预测倾向不明显，建议观望';
  } else {
    level = 'none';
    label = '不建议';
    recommend = '走势混乱，本期不建议出手';
  }

  return {
    score: Math.round(totalScore * 10) / 10,
    level,
    label,
    recommend,
    advantageScore: Math.round(advantageScore),
    sampleScore: Math.round(sampleScore),
    agreementScore: Math.round(agreementScore),
    historyScore: Math.round(historyScore),
    topPct: Math.round(topPct * 10) / 10,
    gap: Math.round(gap * 10) / 10,
    sampleSize: Math.round(sampleSize),
  };
}

/**
 * 计算模型一致性分数
 * 统计各模型预测倾向的一致程度
 */
function computeModelAgreement(models, labels) {
  if (models.length <= 1) return 1.0;

  // 统计每个标签被多少个模型选为最优
  const leanCount = {};
  for (const lb of labels) leanCount[lb] = 0;

  for (const m of models) {
    if (m.lean && leanCount[m.lean] !== undefined) {
      leanCount[m.lean]++;
    }
  }

  const maxCount = Math.max(...Object.values(leanCount));
  return maxCount / models.length;
}

/**
 * 谨慎预测判定
 * 当满足某些条件时，建议用户"观望"而非出手
 */
function shouldBeCautious(finalProbs, labels, options = {}) {
  const {
    sampleSize = 0,
    modelAgreement = 1,
    confidenceScore = 50,
    recentStreak = 0, // 最近连错期数
    category = 'binary',
  } = options;

  const baseline = 100 / labels.length;
  const sorted = Object.entries(finalProbs).sort((a, b) => b[1] - a[1]);
  const topPct = sorted[0][1];
  const advantage = topPct - baseline;

  const reasons = [];

  // 条件1：置信度太低
  if (confidenceScore < 25) {
    reasons.push('置信度过低');
  }

  // 条件2：概率优势太小
  const minAdvantage = category === 'quaternary' ? 5 : 3;
  if (advantage < minAdvantage) {
    reasons.push('概率优势不明显');
  }

  // 条件3：样本量不足
  const minSamples = category === 'quaternary' ? 8 : 15;
  if (sampleSize < minSamples) {
    reasons.push('样本量不足');
  }

  // 条件4：模型分歧太大
  if (modelAgreement < 0.4) {
    reasons.push('模型分歧较大');
  }

  // 条件5：最近连错太多（超过3期）
  if (recentStreak >= 3) {
    reasons.push(`近期连错${recentStreak}期`);
  }

  return {
    cautious: reasons.length >= 2, // 满足2个以上条件就建议谨慎
    reasons,
    level: reasons.length === 0 ? 'safe' : reasons.length === 1 ? 'attention' : 'cautious',
  };
}

// ==================== 组合概率推导（保留兼容） ====================

function deriveComboProbabilities(rDx, rDs) {
  const dx = { '大': parseFloat(rDx['大%'] || 0), '小': parseFloat(rDx['小%'] || 0) };
  const ds = { '单': parseFloat(rDs['单%'] || 0), '双': parseFloat(rDs['双%'] || 0) };
  const combos = {
    '大单': dx['大'] * ds['单'] / 100,
    '大双': dx['大'] * ds['双'] / 100,
    '小单': dx['小'] * ds['单'] / 100,
    '小双': dx['小'] * ds['双'] / 100,
  };
  const total = Object.values(combos).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const k in combos) combos[k] = Math.round(combos[k] * 100 / total * 100) / 100;
  }
  return combos;
}
