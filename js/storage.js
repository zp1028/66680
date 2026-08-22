// 本地存储模块（使用 localStorage 替代 SQLite）

const Storage = {
  PREFIX: 'lottery_pred_',
  
  _getKey(predKey) {
    return this.PREFIX + predKey;
  },
  
  _loadAll(predKey) {
    try {
      const data = localStorage.getItem(this._getKey(predKey));
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },
  
  _saveAll(predKey, records) {
    try {
      localStorage.setItem(this._getKey(predKey), JSON.stringify(records));
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  },
  
  // 插入或更新预测记录
  upsertPrediction(record) {
    const records = this._loadAll(record.key);
    const idx = records.findIndex(r => 
      r.issue === record.issue && r.category === record.category
    );
    
    if (idx >= 0) {
      records[idx] = { ...records[idx], ...record };
    } else {
      record.id = Date.now() + Math.random();
      records.unshift(record);
    }
    
    this._saveAll(record.key, records);
  },
  
  // 批量写入
  batchUpsert(records) {
    if (!records || records.length === 0) return;
    const byKey = {};
    for (const r of records) {
      if (!byKey[r.key]) byKey[r.key] = [];
      byKey[r.key].push(r);
    }
    for (const key in byKey) {
      const existing = this._loadAll(key);
      const existingMap = {};
      for (const r of existing) {
        existingMap[r.issue + '_' + r.category] = r;
      }
      for (const r of byKey[key]) {
        const mapKey = r.issue + '_' + r.category;
        if (existingMap[mapKey]) {
          Object.assign(existingMap[mapKey], r);
        } else {
          r.id = Date.now() + Math.random();
          existing.unshift(r);
          existingMap[mapKey] = r;
        }
      }
      this._saveAll(key, existing);
    }
  },
  
  // 结算预测
  settlePrediction(predKey, issue, category, actual, result, settleIssue) {
    const records = this._loadAll(predKey);
    let changed = false;
    for (const r of records) {
      if (r.issue === issue && r.category === category) {
        r.actual = actual;
        r.result = result;
        r.settleIssue = settleIssue;
        changed = true;
        break;
      }
    }
    if (changed) this._saveAll(predKey, records);
    return changed;
  },
  
  // 加载预测记录
  loadPredictions(predKey, limit = 500, category = null, result = null) {
    let records = this._loadAll(predKey);
    
    if (category) {
      records = records.filter(r => r.category === category);
    }
    if (result) {
      records = records.filter(r => r.result === result);
    }
    
    return records.slice(0, limit);
  },
  
  // 获取模型表现
  getModelPerformance(predKey, limit = 1000, category = null) {
    let records = this._loadAll(predKey);
    records = records.filter(r => 
      (r.result === '对' || r.result === '错') && r.modelName
    );
    if (category && category !== '全部') {
      records = records.filter(r => r.category === category);
    }
    return records.slice(0, limit).map(r => ({
      model: r.modelName,
      category: r.category,
      result: r.result,
      time: r.time,
    }));
  },
  
  // 清空预测记录
  clearPredictions(predKey) {
    localStorage.removeItem(this._getKey(predKey));
  },
  
  // 获取统计摘要
  getStatsSummary(predKey) {
    const records = this._loadAll(predKey);
    const stats = {};
    for (const r of records) {
      if (!stats[r.category]) stats[r.category] = { '对': 0, '错': 0, '待开': 0 };
      if (stats[r.category][r.result] !== undefined) {
        stats[r.category][r.result]++;
      }
    }
    return {
      totalRecords: records.length,
      categoryStats: stats,
    };
  },
};
