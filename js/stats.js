// v5.0 预测战绩统计与追踪模块
// 记录预测历史、计算命中率、连对连错、分类统计等

const PredictionStats = {
  _storageKey: 'prediction_stats_v5',
  _cache: null,

  // 获取某彩种的战绩数据
  getStats(lotteryType) {
    if (!this._cache) this._cache = {};
    if (!this._cache[lotteryType]) {
      try {
        const raw = localStorage.getItem(`${this._storageKey}_${lotteryType}`);
        this._cache[lotteryType] = raw ? JSON.parse(raw) : this._emptyStats();
      } catch (e) {
        this._cache[lotteryType] = this._emptyStats();
      }
    }
    return this._cache[lotteryType];
  },

  _emptyStats() {
    return {
      records: [], // 预测记录 [{issue, category, lean, actual, result, confidence, modelName, time}]
      summary: {
        total: 0,
        correct: 0,
        wrong: 0,
        rate: 0,
      },
      byCategory: {
        '大小': { total: 0, correct: 0, rate: 0 },
        '单双': { total: 0, correct: 0, rate: 0 },
        '组合': { total: 0, correct: 0, rate: 0 },
      },
      byModel: {},
      byConfidence: {
        strong: { total: 0, correct: 0, rate: 0 },
        high: { total: 0, correct: 0, rate: 0 },
        medium: { total: 0, correct: 0, rate: 0 },
        low: { total: 0, correct: 0, rate: 0 },
        none: { total: 0, correct: 0, rate: 0 },
      },
      currentStreak: { type: '-', count: 0 },
      maxWinStreak: 0,
      maxLoseStreak: 0,
      last10: [],
    };
  },

  // 保存战绩数据
  saveStats(lotteryType, stats) {
    if (!this._cache) this._cache = {};
    this._cache[lotteryType] = stats;
    try {
      localStorage.setItem(`${this._storageKey}_${lotteryType}`, JSON.stringify(stats));
    } catch (e) {
      console.warn('[Stats] 保存失败:', e);
    }
  },

  // 添加一条预测记录（开奖后结算调用）
  addRecord(lotteryType, record) {
    const stats = this.getStats(lotteryType);

    // 检查是否已存在同一条记录
    const exists = stats.records.find(
      r => r.issue === record.issue && r.category === record.category
    );
    if (exists) return stats;

    stats.records.unshift({
      ...record,
      time: record.time || new Date().toISOString(),
    });

    // 最多保留500条记录
    if (stats.records.length > 500) {
      stats.records = stats.records.slice(0, 500);
    }

    this._recalculateSummary(stats);
    this.saveStats(lotteryType, stats);
    return stats;
  },

  // 重新计算统计摘要
  _recalculateSummary(stats) {
    const records = stats.records.filter(r => r.result === '对' || r.result === '错');

    // 总体统计
    stats.summary.total = records.length;
    stats.summary.correct = records.filter(r => r.result === '对').length;
    stats.summary.wrong = stats.summary.total - stats.summary.correct;
    stats.summary.rate = stats.summary.total > 0
      ? Math.round(stats.summary.correct / stats.summary.total * 1000) / 10
      : 0;

    // 分类统计
    for (const cat of ['大小', '单双', '组合']) {
      const catRecords = records.filter(r => r.category === cat);
      const catCorrect = catRecords.filter(r => r.result === '对').length;
      stats.byCategory[cat] = {
        total: catRecords.length,
        correct: catCorrect,
        rate: catRecords.length > 0
          ? Math.round(catCorrect / catRecords.length * 1000) / 10
          : 0,
      };
    }

    // 按模型统计
    const byModel = {};
    for (const r of records) {
      const model = r.modelName || '未知';
      if (!byModel[model]) byModel[model] = { total: 0, correct: 0, rate: 0 };
      byModel[model].total++;
      if (r.result === '对') byModel[model].correct++;
    }
    for (const m in byModel) {
      byModel[m].rate = byModel[m].total > 0
        ? Math.round(byModel[m].correct / byModel[m].total * 1000) / 10
        : 0;
    }
    stats.byModel = byModel;

    // 按置信度统计
    const confLevels = ['strong', 'high', 'medium', 'low', 'none'];
    const confLabels = {
      '强烈推荐': 'strong', '推荐': 'high', '一般': 'medium', '偏弱': 'low', '不建议': 'none',
      'strong': 'strong', 'high': 'high', 'medium': 'medium', 'low': 'low', 'none': 'none'
    };
    const byConfidence = {};
    for (const lv of confLevels) byConfidence[lv] = { total: 0, correct: 0, rate: 0 };
    for (const r of records) {
      const lv = confLabels[r.confidence] || 'medium';
      byConfidence[lv].total++;
      if (r.result === '对') byConfidence[lv].correct++;
    }
    for (const lv of confLevels) {
      byConfidence[lv].rate = byConfidence[lv].total > 0
        ? Math.round(byConfidence[lv].correct / byConfidence[lv].total * 1000) / 10
        : 0;
    }
    stats.byConfidence = byConfidence;

    // 连对连错
    this._calcStreaks(stats, records);

    // 最近10期
    stats.last10 = records.slice(0, 10).map(r => ({
      issue: r.issue,
      result: r.result,
      category: r.category,
      lean: r.lean,
      actual: r.actual,
    }));
  },

  _calcStreaks(stats, records) {
    if (records.length === 0) {
      stats.currentStreak = { type: '-', count: 0 };
      stats.maxWinStreak = 0;
      stats.maxLoseStreak = 0;
      return;
    }

    // 当前连对/连错
    const currentResult = records[0].result;
    let currentCount = 1;
    for (let i = 1; i < records.length; i++) {
      if (records[i].result === currentResult) currentCount++;
      else break;
    }
    stats.currentStreak = {
      type: currentResult === '对' ? '连对' : '连错',
      count: currentCount,
    };

    // 最大连对连错
    let maxWin = 0;
    let maxLose = 0;
    let tempStreak = 1;
    let tempType = records[0].result;

    for (let i = 1; i < records.length; i++) {
      if (records[i].result === tempType) {
        tempStreak++;
      } else {
        if (tempType === '对' && tempStreak > maxWin) maxWin = tempStreak;
        if (tempType === '错' && tempStreak > maxLose) maxLose = tempStreak;
        tempStreak = 1;
        tempType = records[i].result;
      }
    }
    if (tempType === '对' && tempStreak > maxWin) maxWin = tempStreak;
    if (tempType === '错' && tempStreak > maxLose) maxLose = tempStreak;

    stats.maxWinStreak = maxWin;
    stats.maxLoseStreak = maxLose;
  },

  // 获取最近N期的命中率趋势（用于图表）
  getTrendData(lotteryType, period = 30) {
    const stats = this.getStats(lotteryType);
    const records = stats.records.filter(r => r.result === '对' || r.result === '错');

    if (records.length === 0) return { labels: [], rates: [] };

    const recent = records.slice(0, period);
    const labels = [];
    const rates = [];

    // 计算移动平均命中率
    let correct = 0;
    const windowSize = Math.min(5, recent.length);

    for (let i = 0; i < recent.length; i++) {
      labels.push(recent[i].issue?.slice(-3) || `第${recent.length - i}期`);
      if (recent[i].result === '对') correct++;

      if (i >= windowSize - 1) {
        const rate = Math.round(correct / windowSize * 100);
        rates.push(rate);
        if (recent[i - windowSize + 1].result === '对') correct--;
      } else {
        rates.push(Math.round(correct / (i + 1) * 100));
      }
    }

    return {
      labels: labels.reverse(),
      rates: rates.reverse(),
    };
  },

  // 获取按置信度的准确率分布
  getConfidenceStats(lotteryType) {
    const stats = this.getStats(lotteryType);
    const records = stats.records.filter(r => r.result === '对' || r.result === '错');

    const result = {
      '高': { total: 0, correct: 0, rate: 0 },
      '中': { total: 0, correct: 0, rate: 0 },
      '低': { total: 0, correct: 0, rate: 0 },
    };

    for (const r of records) {
      const conf = r.confidence || '低';
      if (result[conf]) {
        result[conf].total++;
        if (r.result === '对') result[conf].correct++;
      }
    }

    for (const conf in result) {
      result[conf].rate = result[conf].total > 0
        ? Math.round(result[conf].correct / result[conf].total * 1000) / 10
        : 0;
    }

    return result;
  },

  // 批量回填历史预测结果（用已有历史数据快速积累战绩）
  async backfill(lotteryType, seq, labels, category, limit = 100) {
    const stats = this.getStats(lotteryType);
    const startLen = stats.records.length;

    // 从后往前回测
    const testLimit = Math.min(limit, seq.length - 20);
    for (let t = seq.length - testLimit; t < seq.length - 1; t++) {
      const train = seq.slice(0, t);
      const actual = seq[t + 1];

      try {
        const model = predictSelected(train, labels);
        if (model && model.lean) {
          const result = model.lean === actual ? '对' : '错';
          stats.records.push({
            issue: `回算${t}`,
            category,
            lean: model.lean,
            actual,
            result,
            confidence: model.confidence,
            modelName: model.selectedModel?.name || '自适应',
            time: new Date(Date.now() - (seq.length - t) * 60000).toISOString(),
            isBackfilled: true,
          });
        }
      } catch (e) { continue; }
    }

    // 按时间倒序排列
    stats.records.sort((a, b) => new Date(b.time) - new Date(a.time));

    // 最多保留500条
    if (stats.records.length > 500) {
      stats.records = stats.records.slice(0, 500);
    }

    this._recalculateSummary(stats);
    this.saveStats(lotteryType, stats);

    return {
      added: stats.records.length - startLen,
      total: stats.records.length,
    };
  },

  // 重置战绩
  reset(lotteryType) {
    this._cache = this._cache || {};
    this._cache[lotteryType] = this._emptyStats();
    try {
      localStorage.removeItem(`${this._storageKey}_${lotteryType}`);
    } catch (e) {}
    return this._cache[lotteryType];
  },
};
