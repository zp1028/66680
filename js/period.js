// v5.0 时段/日期模式分析模块
// 分析不同时段、星期、日期的走势分布

const PeriodAnalysis = {
  // 时段划分（24小时制）
  PERIODS: [
    { key: 'dawn', name: '凌晨', start: 0, end: 6 },
    { key: 'morning', name: '上午', start: 6, end: 12 },
    { key: 'afternoon', name: '下午', start: 12, end: 18 },
    { key: 'evening', name: '晚上', start: 18, end: 24 },
  ],

  WEEKDAYS: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],

  // 根据开奖时间获取时段
  getPeriodOfTime(timeStr) {
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) {
        // 尝试解析 HH:mm:ss 格式
        const match = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (match) {
          const hour = parseInt(match[1]);
          return this._getPeriodByHour(hour);
        }
        return null;
      }
      return this._getPeriodByHour(d.getHours());
    } catch (e) {
      return null;
    }
  },

  _getPeriodByHour(hour) {
    for (const p of this.PERIODS) {
      if (hour >= p.start && hour < p.end) {
        return p.key;
      }
    }
    return 'evening'; // 24点归到晚上
  },

  // 获取星期
  getWeekday(timeStr) {
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return null;
      return this.WEEKDAYS[d.getDay()];
    } catch (e) {
      return null;
    }
  },

  // 分析各时段的大小/单双分布
  analyzeByPeriod(rows, getValue, getTime, labels) {
    const result = {};
    for (const p of this.PERIODS) {
      result[p.key] = {
        name: p.name,
        total: 0,
        counts: {},
        pcts: {},
      };
      for (const lb of labels) result[p.key].counts[lb] = 0;
    }

    for (const row of rows) {
      const period = this.getPeriodOfTime(getTime(row));
      const val = getValue(row);
      if (!period || !val) continue;
      if (result[period] && result[period].counts[val] !== undefined) {
        result[period].total++;
        result[period].counts[val]++;
      }
    }

    // 计算百分比
    for (const pKey in result) {
      const r = result[pKey];
      for (const lb of labels) {
        r.pcts[lb] = r.total > 0
          ? Math.round(r.counts[lb] / r.total * 1000) / 10
          : 0;
      }
    }

    return result;
  },

  // 分析各星期的分布
  analyzeByWeekday(rows, getValue, getTime, labels) {
    const result = {};
    for (const wd of this.WEEKDAYS) {
      result[wd] = {
        name: wd,
        total: 0,
        counts: {},
        pcts: {},
      };
      for (const lb of labels) result[wd].counts[lb] = 0;
    }

    for (const row of rows) {
      const weekday = this.getWeekday(getTime(row));
      const val = getValue(row);
      if (!weekday || !val) continue;
      if (result[weekday] && result[weekday].counts[val] !== undefined) {
        result[weekday].total++;
        result[weekday].counts[val]++;
      }
    }

    // 计算百分比
    for (const wd in result) {
      const r = result[wd];
      for (const lb of labels) {
        r.pcts[lb] = r.total > 0
          ? Math.round(r.counts[lb] / r.total * 1000) / 10
          : 0;
      }
    }

    return result;
  },

  // 分析当前时段的历史走势（用于预测加权）
  getCurrentPeriodBias(rows, getValue, getTime, labels) {
    const now = new Date();
    const currentPeriod = this._getPeriodByHour(now.getHours());
    const currentWeekday = this.WEEKDAYS[now.getDay()];

    // 分析当前时段
    const periodData = this.analyzeByPeriod(rows, getValue, getTime, labels);
    const weekdayData = this.analyzeByWeekday(rows, getValue, getTime, labels);

    const periodStats = periodData[currentPeriod];
    const weekdayStats = weekdayData[currentWeekday];

    // 计算偏差度（相对于50%基准的偏离）
    const baseline = 100 / labels.length;

    let periodBias = 0;
    if (periodStats && periodStats.total >= 20) {
      // 取最大概率标签的偏差
      const maxPct = Math.max(...Object.values(periodStats.pcts));
      periodBias = maxPct - baseline;
    }

    let weekdayBias = 0;
    if (weekdayStats && weekdayStats.total >= 20) {
      const maxPct = Math.max(...Object.values(weekdayStats.pcts));
      weekdayBias = maxPct - baseline;
    }

    return {
      currentPeriod,
      currentPeriodName: periodStats?.name || '',
      currentWeekday,
      periodStats,
      weekdayStats,
      periodBias,
      weekdayBias,
      combinedBias: (periodBias * 0.6 + weekdayBias * 0.4),
      hasEnoughData: (periodStats?.total || 0) >= 20,
    };
  },

  // 获取时段分析的完整报告
  getFullReport(rows, getValue, getTime, labels) {
    return {
      byPeriod: this.analyzeByPeriod(rows, getValue, getTime, labels),
      byWeekday: this.analyzeByWeekday(rows, getValue, getTime, labels),
      currentBias: this.getCurrentPeriodBias(rows, getValue, getTime, labels),
    };
  },

  // 冷热号时段分析
  analyzeHotColdByPeriod(rows, getNumbers, getTime, numRange) {
    const result = {};
    for (const p of this.PERIODS) {
      result[p.key] = {
        name: p.name,
        total: 0,
        counts: {},
        pcts: {},
      };
      for (const n of numRange) result[p.key].counts[n] = 0;
    }

    for (const row of rows) {
      const period = this.getPeriodOfTime(getTime(row));
      const nums = getNumbers(row);
      if (!period || !nums) continue;

      result[period].total++;
      for (const n of nums) {
        if (result[period].counts[n] !== undefined) {
          result[period].counts[n]++;
        }
      }
    }

    // 计算百分比
    for (const pKey in result) {
      const r = result[pKey];
      const totalNums = r.total * (numRange.length / 2 || 5); // 估算总号码数
      for (const n of numRange) {
        r.pcts[n] = totalNums > 0
          ? Math.round(r.counts[n] / totalNums * 1000) / 10
          : 0;
      }
    }

    // 为每个时段找出最热和最冷的号码
    for (const pKey in result) {
      const r = result[pKey];
      const entries = Object.entries(r.pcts).sort((a, b) => b[1] - a[1]);
      r.hotNumbers = entries.slice(0, 5).map(([n, p]) => ({ number: parseInt(n), pct: p }));
      r.coldNumbers = entries.slice(-5).reverse().map(([n, p]) => ({ number: parseInt(n), pct: p }));
    }

    return result;
  },
};
