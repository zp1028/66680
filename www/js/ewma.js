/**
 * EWMA 自适应学习模块
 * 指数加权移动平均 — 预测对了加分，错了衰减，越近期权重越大
 */
(function(global) {
  'use strict';

  // 学习率：0.15 表示近期约 7 期的影响占主导
  const DEFAULT_ALPHA = 0.15;
  // 初始评分基准（二分类随机水平）
  const BASELINE_SCORE = 0.50;

  /**
   * EWMA 评分管理器
   * 按彩种 + 预测类别 + 模型名 维护独立评分
   */
  class EWMAManager {
    constructor(cacheDB) {
      this.cache = cacheDB;
      this.alpha = DEFAULT_ALPHA;
      this._scores = null; // 内存缓存 { lotteryType: { category: { modelName: score } } }
      this._loaded = false;
    }

    /**
     * 设置学习率
     */
    setAlpha(alpha) {
      this.alpha = alpha || DEFAULT_ALPHA;
    }

    /**
     * 从 IndexedDB 加载所有评分
     */
    async loadAll(lotteryType) {
      if (!this._scores) this._scores = {};
      if (!this.cache || !this.cache.getAllEwmScores) {
        this._scores[lotteryType] = {};
        this._loaded = true;
        return this._scores[lotteryType];
      }
      try {
        const all = await this.cache.getAllEwmScores(lotteryType);
        this._scores[lotteryType] = all || {};
        this._loaded = true;
        return this._scores[lotteryType];
      } catch (e) {
        console.warn('[EWMA] 加载评分失败:', e);
        this._scores[lotteryType] = {};
        this._loaded = true;
        return this._scores[lotteryType];
      }
    }

    /**
     * 确保已加载
     */
    async _ensureLoaded(lotteryType) {
      if (!this._loaded) {
        await this.loadAll(lotteryType);
      }
      if (!this._scores[lotteryType]) {
        this._scores[lotteryType] = {};
      }
    }

    /**
     * 获取某个模型的 EWMA 评分
     */
    async getScore(lotteryType, category, modelName) {
      await this._ensureLoaded(lotteryType);
      const cat = this._scores[lotteryType][category];
      if (cat && cat[modelName] !== undefined) {
        return cat[modelName];
      }
      return BASELINE_SCORE;
    }

    /**
     * 获取某类别下所有模型的评分
     */
    async getAllScores(lotteryType, category) {
      await this._ensureLoaded(lotteryType);
      return this._scores[lotteryType][category] || {};
    }

    /**
     * 更新评分（开奖后结算调用）
     * @param {string} lotteryType
     * @param {string} category - daxiao/danshuang/zuhe/pos_0/pos_1...
     * @param {Object} results - { modelName: isCorrect(boolean) }
     */
    async updateScores(lotteryType, category, results) {
      await this._ensureLoaded(lotteryType);
      if (!this._scores[lotteryType][category]) {
        this._scores[lotteryType][category] = {};
      }
      const catScores = this._scores[lotteryType][category];

      for (const [modelName, isCorrect] of Object.entries(results)) {
        const oldScore = catScores[modelName] !== undefined ? catScores[modelName] : BASELINE_SCORE;
        const result = isCorrect ? 1 : 0;
        // EWMA 公式: new = α * result + (1-α) * old
        const newScore = this.alpha * result + (1 - this.alpha) * oldScore;
        catScores[modelName] = Math.max(0, Math.min(1, newScore));
      }

      // 持久化
      if (this.cache && this.cache.saveEwmScores) {
        try {
          await this.cache.saveEwmScores(lotteryType, category, catScores);
        } catch (e) {
          console.warn('[EWMA] 保存评分失败:', e);
        }
      }

      return catScores;
    }

    /**
     * 根据 EWMA 评分计算模型权重
     * 使用 softmax-ish 归一化，评分高的权重显著更高
     * @param {Object} scores - { modelName: score }
     * @returns {Object} { modelName: weight }
     */
    computeWeights(scores) {
      const entries = Object.entries(scores);
      if (entries.length === 0) return {};
      if (entries.length === 1) return { [entries[0][0]]: 1 };

      // 找出最低分做偏移，避免负值
      const minScore = Math.min(...entries.map(([, s]) => s));
      // 温度系数：控制权重分布的锐度
      const temperature = 0.1;

      // 指数加权
      const exps = entries.map(([name, s]) => ({
        name,
        exp: Math.exp((s - minScore) / temperature)
      }));
      const sum = exps.reduce((acc, e) => acc + e.exp, 0);

      const weights = {};
      exps.forEach(e => {
        weights[e.name] = e.exp / sum;
      });
      return weights;
    }

    /**
     * 重置某类别的评分（用于调试或数据异常时）
     */
    async resetCategory(lotteryType, category) {
      await this._ensureLoaded(lotteryType);
      this._scores[lotteryType][category] = {};
      if (this.cache && this.cache.saveEwmScores) {
        await this.cache.saveEwmScores(lotteryType, category, {});
      }
    }

    /**
     * 获取某类别下的最佳模型名
     */
    async getBestModel(lotteryType, category) {
      const scores = await this.getAllScores(lotteryType, category);
      const entries = Object.entries(scores);
      if (entries.length === 0) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    }
  }

  // 导出
  global.EWMAManager = EWMAManager;
  global.EWMA_BASELINE = BASELINE_SCORE;
  global.EWMA_ALPHA = DEFAULT_ALPHA;

})(window);
