// IndexedDB 数据模块 v3 - 缓存 + 持久化历史数据库 + 预测统计 + EWMA评分
const CacheDB = {
  dbName: 'LotteryAppDB',
  dbVersion: 3,
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion || 0;

        // === 缓存表（有TTL，会过期） ===

        // 历史数据缓存（按天）
        if (!db.objectStoreNames.contains('history')) {
          const store = db.createObjectStore('history', { keyPath: 'key' });
          store.createIndex('lotCode', 'lotCode', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }

        // 实时数据缓存
        if (!db.objectStoreNames.contains('latest')) {
          db.createObjectStore('latest', { keyPath: 'lotCode' });
        }

        // === 持久化数据库（永久保存，不会过期） ===

        // 开奖历史数据库（按期号存储，永久保存）
        if (!db.objectStoreNames.contains('draw_history')) {
          const store = db.createObjectStore('draw_history', { keyPath: 'id' });
          store.createIndex('lotCode', 'lotCode', { unique: false });
          store.createIndex('issue', 'issue', { unique: false });
          store.createIndex('lotCode_issue', ['lotCode', 'issue'], { unique: true });
          store.createIndex('date', 'date', { unique: false });
        }

        // 预测统计数据库（按彩种+类别汇总统计）
        if (!db.objectStoreNames.contains('pred_stats')) {
          const store = db.createObjectStore('pred_stats', { keyPath: 'id' });
          store.createIndex('lotCode', 'lotCode', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }

        // v3 新增：EWMA 自适应评分表
        if (!db.objectStoreNames.contains('ewma_scores')) {
          const store = db.createObjectStore('ewma_scores', { keyPath: 'id' });
          store.createIndex('lotCode', 'lotCode', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }
      };
    });
  },

  _ensureDB() {
    if (!this.db) return this.init();
    return Promise.resolve();
  },

  // ==================== 缓存相关（有TTL） ====================

  async setHistory(lotCode, date, data, ttl = 3600000) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('history', 'readwrite');
      const store = tx.objectStore('history');
      store.put({
        key: `${lotCode}_${date}`,
        lotCode,
        date,
        data,
        timestamp: Date.now(),
        ttl,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getHistory(lotCode, date) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('history', 'readonly');
      const store = tx.objectStore('history');
      const key = `${lotCode}_${date}`;
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) return resolve(null);
        if (Date.now() - result.timestamp > result.ttl) {
          const delTx = this.db.transaction('history', 'readwrite');
          delTx.objectStore('history').delete(key);
          return resolve(null);
        }
        resolve(result.data);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async setLatest(lotCode, data, ttl = 15000) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('latest', 'readwrite');
      const store = tx.objectStore('latest');
      store.put({
        lotCode,
        data,
        timestamp: Date.now(),
        ttl,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getLatest(lotCode) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('latest', 'readonly');
      const store = tx.objectStore('latest');
      const request = store.get(lotCode);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) return resolve(null);
        if (Date.now() - result.timestamp > result.ttl) return resolve(null);
        resolve(result.data);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // ==================== 持久化历史数据库（永久保存） ====================

  // 批量写入/更新开奖历史数据（去重）
  async saveDrawHistory(lotCode, rows) {
    if (!rows || rows.length === 0) return 0;
    await this._ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('draw_history', 'readwrite');
      const store = tx.objectStore('draw_history');
      let added = 0;

      for (const row of rows) {
        const issue = String(row['期号'] || '');
        if (!issue) continue;
        const id = `${lotCode}_${issue}`;
        const date = String(row['开奖时间'] || '').slice(0, 10);

        // 用 put 而不是 add，这样已存在的会更新
        store.put({
          id,
          lotCode,
          issue,
          date,
          row: JSON.parse(JSON.stringify(row)), // 深拷贝
          savedAt: Date.now(),
        });
        added++;
      }

      tx.oncomplete = () => resolve(added);
      tx.onerror = () => reject(tx.error);
    });
  },

  // 获取某个彩种的所有历史数据（按期号升序）
  async getDrawHistory(lotCode) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('draw_history', 'readonly');
      const store = tx.objectStore('draw_history');
      const idx = store.index('lotCode');
      const rows = [];

      idx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          rows.push(cursor.value.row);
          cursor.continue();
        } else {
          // 按期号排序
          rows.sort((a, b) => {
            const ai = parseInt(a['期号']);
            const bi = parseInt(b['期号']);
            if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
            return a['期号'].localeCompare(b['期号']);
          });
          resolve(rows);
        }
      };

      tx.onerror = () => reject(tx.error);
    });
  },

  // 获取最近 N 期历史数据
  async getRecentDrawHistory(lotCode, n) {
    const all = await this.getDrawHistory(lotCode);
    if (all.length <= n) return all;
    return all.slice(all.length - n);
  },

  // 获取某个彩种的历史数据量
  async getDrawHistoryCount(lotCode) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('draw_history', 'readonly');
      const store = tx.objectStore('draw_history');
      const idx = store.index('lotCode');
      const request = idx.count(lotCode);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  // 获取最新一期的期号
  async getLatestIssue(lotCode) {
    const rows = await this.getDrawHistory(lotCode);
    if (rows.length === 0) return null;
    return rows[rows.length - 1];
  },

  // 获取最老一期的期号
  async getEarliestIssue(lotCode) {
    const rows = await this.getDrawHistory(lotCode);
    if (rows.length === 0) return null;
    return rows[0];
  },

  // 检查某一天是否已有数据
  async hasDateData(lotCode, date) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('draw_history', 'readonly');
      const store = tx.objectStore('draw_history');
      const idx = store.index('date');
      // 用复合索引会更准，但 date 索引是单字段，会跨彩种
      // 这里用 lotCode + date 组合来查
      const lotIdx = store.index('lotCode');
      let found = false;

      lotIdx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.date === date) {
            found = true;
            resolve(true);
            return;
          }
          cursor.continue();
        } else {
          resolve(found);
        }
      };

      tx.onerror = () => reject(tx.error);
    });
  },

  // 清除某个彩种的历史数据库
  async clearDrawHistory(lotCode) {
    await this._ensureDB();
    return new Promise((resolve) => {
      const tx = this.db.transaction('draw_history', 'readwrite');
      const store = tx.objectStore('draw_history');
      const idx = store.index('lotCode');

      idx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  },

  // ==================== 预测统计持久化 ====================

  // 保存预测统计
  async savePredStats(lotCode, category, stats) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pred_stats', 'readwrite');
      const store = tx.objectStore('pred_stats');
      store.put({
        id: `${lotCode}_${category}`,
        lotCode,
        category,
        stats: JSON.parse(JSON.stringify(stats)),
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // 获取预测统计
  async getPredStats(lotCode, category) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pred_stats', 'readonly');
      const store = tx.objectStore('pred_stats');
      const request = store.get(`${lotCode}_${category}`);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.stats : null);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // 获取某个彩种所有类别的统计
  async getAllPredStats(lotCode) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pred_stats', 'readonly');
      const store = tx.objectStore('pred_stats');
      const idx = store.index('lotCode');
      const stats = {};

      idx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          stats[cursor.value.category] = cursor.value.stats;
          cursor.continue();
        } else {
          resolve(stats);
        }
      };

      tx.onerror = () => reject(tx.error);
    });
  },

  // 清除预测统计
  async clearPredStats(lotCode) {
    await this._ensureDB();
    return new Promise((resolve) => {
      const tx = this.db.transaction('pred_stats', 'readwrite');
      const store = tx.objectStore('pred_stats');
      const idx = store.index('lotCode');

      idx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  },

  // ==================== EWMA 评分持久化（v4 新增） ====================

  // 保存某个类别下所有模型的 EWMA 评分
  async saveEwmScores(lotCode, category, scores) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('ewma_scores', 'readwrite');
      const store = tx.objectStore('ewma_scores');
      store.put({
        id: `${lotCode}_${category}`,
        lotCode,
        category,
        scores: JSON.parse(JSON.stringify(scores)),
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // 获取某个类别的 EWMA 评分
  async getEwmScores(lotCode, category) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('ewma_scores', 'readonly');
      const store = tx.objectStore('ewma_scores');
      const request = store.get(`${lotCode}_${category}`);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.scores : null);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // 获取某个彩种所有类别的 EWMA 评分
  async getAllEwmScores(lotCode) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('ewma_scores', 'readonly');
      const store = tx.objectStore('ewma_scores');
      const idx = store.index('lotCode');
      const scores = {};

      idx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          scores[cursor.value.category] = cursor.value.scores;
          cursor.continue();
        } else {
          resolve(scores);
        }
      };

      tx.onerror = () => reject(tx.error);
    });
  },

  // 清除某个彩种的 EWMA 评分
  async clearEwmScores(lotCode) {
    await this._ensureDB();
    return new Promise((resolve) => {
      const tx = this.db.transaction('ewma_scores', 'readwrite');
      const store = tx.objectStore('ewma_scores');
      const idx = store.index('lotCode');

      idx.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  },

  // ==================== 缓存清理 ====================

  async clearLottery(lotCode) {
    await this._ensureDB();
    await this.clearDrawHistory(lotCode);
    await this.clearPredStats(lotCode);
    await this.clearEwmScores(lotCode);

    // 清除缓存表
    return new Promise((resolve) => {
      const tx1 = this.db.transaction('history', 'readwrite');
      const idx1 = tx1.objectStore('history').index('lotCode');
      idx1.openCursor(lotCode).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };

      const tx2 = this.db.transaction('latest', 'readwrite');
      tx2.objectStore('latest').delete(lotCode);

      resolve();
    });
  },

  async cleanupExpired() {
    await this._ensureDB();
    const now = Date.now();
    const stores = ['history', 'latest'];

    for (const storeName of stores) {
      await new Promise((resolve) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            if (now - cursor.value.timestamp > cursor.value.ttl) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
      });
    }
  },

  // 获取数据库总大小（估算）
  async getDbStats() {
    await this._ensureDB();
    const stats = {
      drawHistory: 0,
      predStats: 0,
      ewmaScores: 0,
      cacheCount: 0,
    };

    // 统计开奖历史
    await new Promise((resolve) => {
      const tx = this.db.transaction('draw_history', 'readonly');
      const req = tx.objectStore('draw_history').count();
      req.onsuccess = () => { stats.drawHistory = req.result; resolve(); };
      req.onerror = () => resolve();
    });

    // 统计预测统计
    await new Promise((resolve) => {
      const tx = this.db.transaction('pred_stats', 'readonly');
      const req = tx.objectStore('pred_stats').count();
      req.onsuccess = () => { stats.predStats = req.result; resolve(); };
      req.onerror = () => resolve();
    });

    // 统计 EWMA 评分
    await new Promise((resolve) => {
      const tx = this.db.transaction('ewma_scores', 'readonly');
      const req = tx.objectStore('ewma_scores').count();
      req.onsuccess = () => { stats.ewmaScores = req.result; resolve(); };
      req.onerror = () => resolve();
    });

    // 统计缓存
    await new Promise((resolve) => {
      const tx = this.db.transaction('history', 'readonly');
      const req = tx.objectStore('history').count();
      req.onsuccess = () => { stats.cacheCount = req.result; resolve(); };
      req.onerror = () => resolve();
    });

    return stats;
  },
};

// 自动初始化
if (typeof indexedDB !== 'undefined') {
  CacheDB.init().catch(e => console.warn('IndexedDB init failed:', e));
  // 定期清理过期缓存
  setInterval(() => CacheDB.cleanupExpired().catch(() => {}), 60000);
}
