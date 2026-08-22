// 彩种适配器 v4.0 - 支持位置号码预测 + 组合独立序列 + 和值交叉特征 + 批量回填

// ==================== Luck20 适配器 ====================

function classifyLuck20Sum(s, apiBigSmall, apiSingleDouble) {
  let dx, ds;
  if (apiBigSmall !== undefined && apiBigSmall !== null && String(apiBigSmall) !== '') {
    try { dx = parseInt(apiBigSmall) === 1 ? '大' : '小'; }
    catch (e) { dx = s >= 810 ? '大' : '小'; }
  } else { dx = s >= 810 ? '大' : '小'; }

  if (apiSingleDouble !== undefined && apiSingleDouble !== null && String(apiSingleDouble) !== '') {
    try { ds = parseInt(apiSingleDouble) === 1 ? '单' : '双'; }
    catch (e) { ds = s % 2 === 1 ? '单' : '双'; }
  } else { ds = s % 2 === 1 ? '单' : '双'; }

  return { dx, ds, combo: dx + ds };
}

function parseLuck20Item(it) {
  const code = String(it.preDrawCode || '');
  const allNums = code.split(',').filter(x => x.trim() !== '').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
  if (allNums.length < 20) return null;

  const nums = allNums.slice(0, 20);
  const extra = allNums.length > 20 ? allNums[20] : null;

  let s;
  try { s = parseInt(it.sumNum); if (isNaN(s)) throw new Error(); }
  catch (e) { s = nums.reduce((a, b) => a + b, 0); }

  const { dx, ds, combo } = classifyLuck20Sum(s, it.sumBigSmall, it.sumSingleDouble);

  const row = {
    期号: String(it.preDrawIssue || ''),
    开奖时间: String(it.preDrawTime || ''),
    号码: nums,
    附加号: extra,
    和值: s,
    大小: dx,
    单双: ds,
    组合: combo,
  };

  for (let i = 0; i < 20; i++) {
    row['号' + (i + 1)] = nums[i];
  }

  return row;
}

class Luck20Adapter {
  constructor(config) {
    this.config = config;
    this.positionNames = ['第1位', '第2位', '第3位', '第4位', '第5位'];
    this.positionKeys = ['号1', '号2', '号3', '号4', '号5'];
    this.numberRange = Array.from({ length: 80 }, (_, i) => i + 1);
  }

  async _historyItems(endpoint, day) {
    const bases = [Settings.apiBase, Settings.apiBaseAlt];
    for (const base of bases) {
      const data = await safeJsonGet(base + '/' + endpoint + '?lotCode=' + this.config.code + '&date=' + day);
      if (data) {
        const items = ((data.result || {}).data) || [];
        if (items && items.length > 0) return items;
      }
    }
    return [];
  }

  async fetchLatest() {
    const url = Settings.apiBase + '/LuckTwenty/getBaseLuckTewnty.do?lotCode=' + this.config.code;
    const data = await safeJsonGet(url);
    if (!data || data.errorCode !== 0) return null;

    const d = (data.result || {}).data || {};
    const row = parseLuck20Item(d);
    if (!row) return null;

    row['下期期号'] = String(d.drawIssue || '');
    row['下期时间'] = String(d.drawTime || '');
    row['服务器时间'] = String(d.serverTime || '');
    return row;
  }

  async fetchHistory(days = 3) {
    const today = new Date();
    const daysList = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      daysList.push(d.toISOString().slice(0, 10));
    }

    const rows = [];
    const promises = daysList.map(day =>
      this._historyItems('LuckTwenty/getBaseLuckTwentyList.do', day)
    );
    const results = await Promise.all(promises);

    for (const items of results) {
      for (const it of items) {
        const row = parseLuck20Item(it);
        if (row) rows.push(row);
      }
    }

    if (rows.length === 0) return [];

    const seen = new Set();
    const unique = [];
    for (const r of rows) {
      if (!seen.has(r['期号'])) {
        seen.add(r['期号']);
        unique.push(r);
      }
    }

    unique.sort((a, b) => {
      const ai = parseInt(a['期号']);
      const bi = parseInt(b['期号']);
      if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
      return a['期号'].localeCompare(b['期号']);
    });

    return unique;
  }

  extractSequences(rows) {
    const seqs = {
      '大小': rows.map(r => r['大小']),
      '单双': rows.map(r => r['单双']),
      '组合': rows.map(r => r['组合']),
    };
    // 位置号码序列（前5位）
    for (let i = 0; i < this.positionKeys.length; i++) {
      seqs['pos_' + (i + 1)] = rows.map(r => String(r[this.positionKeys[i]]));
    }
    return seqs;
  }

  // v4 新增：提取和值序列（用于交叉特征）
  extractSumSequence(rows) {
    return rows.map(r => parseInt(r['和值']) || 0);
  }

  // v4 新增：获取和值范围
  getSumRange() {
    return { min: 210, max: 1410 }; // 幸运20：20个号码，最小1+2+...+20=210，最大61+...+80=1410
  }

  getLabels(category) {
    const map = {
      '大小': ['大', '小'],
      '单双': ['单', '双'],
      '组合': ['大单', '大双', '小单', '小双'],
    };
    // 位置类别的标签是号码 1-80
    if (category && category.startsWith('pos_')) {
      return this.numberRange.map(String);
    }
    return map[category] || [];
  }

  getActual(latest, category) {
    if (category === '大小') return latest['大小'];
    if (category === '单双') return latest['单双'];
    if (category === '组合') {
      const dx = latest['大小'];
      const ds = latest['单双'];
      if (dx && ds) return dx + ds;
    }
    // 位置实际号码
    if (category && category.startsWith('pos_')) {
      const idx = parseInt(category.split('_')[1]) - 1;
      if (idx >= 0 && idx < this.positionKeys.length) {
        return String(latest[this.positionKeys[idx]]);
      }
    }
    return null;
  }

  // 获取位置预测配置
  get positionConfig() {
    return {
      enabled: true,
      positions: this.positionNames.map((name, i) => ({
        name,
        key: 'pos_' + (i + 1),
        seqKey: 'pos_' + (i + 1),
      })),
      topN: Settings.positionTopN || 3,
      numberRange: this.numberRange,
    };
  }

  // v4 新增：组合预测是否启用
  get zuheEnabled() {
    return true;
  }

  renderLive(rt) {
    const nums = rt['号码'];
    const extra = rt['附加号'];
    const extraHtml = extra !== null && extra !== undefined
      ? '　附加号 <span class="num-ball gold">' + String(extra).padStart(2, '0') + '</span>'
      : '';
    const balls = nums.map(n =>
      '<span class="num-ball green">' + String(n).padStart(2, '0') + '</span>'
    ).join('');

    return (
      '<div class="title">🟢 ' + this.config.name + ' · 实时开奖</div>' +
      '<div class="meta">第 ' + rt['期号'] + ' 期　' + String(rt['开奖时间']).slice(0, 19) + '</div>' +
      '<div class="balls-row">' + balls + extraHtml + '</div>' +
      '<div style="text-align:center"><span class="tag-combo">' +
      '和值 ' + rt['和值'] + ' · ' + rt['大小'] + ' · ' + rt['单双'] + ' · ' + rt['组合'] +
      '</span></div>'
    );
  }

  get predKey() {
    return 'l20_' + this.config.code;
  }

  get defaultCategories() {
    return ['大小', '单双', '组合'];
  }
}

// ==================== PK10 适配器 ====================

class PKSAdapter {
  constructor(config) {
    this.config = config;
    this.positionNames = ['冠军', '亚军', '第三名', '第四名', '第五名'];
    this.positionKeys = POS_COLS.slice(0, 5); // 前5名
    this.numberRange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  async _historyItems(endpoint, day) {
    const bases = [Settings.apiBase, Settings.apiBaseAlt];
    for (const base of bases) {
      const data = await safeJsonGet(base + '/' + endpoint + '?lotCode=' + this.config.code + '&date=' + day);
      if (data) {
        const items = ((data.result || {}).data) || [];
        if (items && items.length > 0) return items;
      }
    }
    return [];
  }

  async fetchLatest() {
    const url = Settings.apiBase + '/pks/getLotteryPksInfo.do?lotCode=' + this.config.code;
    const data = await safeJsonGet(url);
    if (!data || data.errorCode !== 0) return null;

    const d = (data.result || {}).data || {};
    const code = String(d.preDrawCode || '');
    const nums = code.split(',').filter(x => x.trim() !== '').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
    if (nums.length !== 10) return null;

    const result = {
      '期号': String(d.preDrawIssue || ''),
      '开奖时间': String(d.drawTime || d.preDrawTime || ''),
      '下期期号': String(d.drawIssue || ''),
      '下期时间': String(d.drawTime || ''),
      '服务器时间': String(d.serverTime || ''),
      '冠亚和': nums[0] + nums[1],
    };

    for (let i = 0; i < POS_COLS.length; i++) {
      result[POS_COLS[i]] = nums[i];
    }

    return result;
  }

  async fetchHistory(days = 3) {
    const today = new Date();
    const daysList = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      daysList.push(d.toISOString().slice(0, 10));
    }

    const rows = [];
    const promises = daysList.map(day =>
      this._historyItems('pks/getPksHistoryList.do', day)
    );
    const results = await Promise.all(promises);

    for (const items of results) {
      for (const it of items) {
        const code = String(it.preDrawCode || '');
        const nums = code.split(',').filter(x => x.trim() !== '').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
        if (nums.length !== 10) continue;

        const row = {
          '期号': String(it.preDrawIssue || ''),
          '开奖时间': it.preDrawTime || '',
          '冠亚和': nums[0] + nums[1],
        };
        for (let i = 0; i < POS_COLS.length; i++) {
          row[POS_COLS[i]] = nums[i];
        }
        rows.push(row);
      }
    }

    if (rows.length === 0) return [];

    const seen = new Set();
    const unique = [];
    for (const r of rows) {
      if (!seen.has(r['期号'])) {
        seen.add(r['期号']);
        unique.push(r);
      }
    }

    unique.sort((a, b) => {
      const ai = parseInt(a['期号']);
      const bi = parseInt(b['期号']);
      if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
      return a['期号'].localeCompare(b['期号']);
    });

    return unique;
  }

  extractSequences(rows) {
    const seqs = {
      '大小': rows.map(r => parseInt(r['冠亚和']) > 11 ? '大' : '小'),
      '单双': rows.map(r => parseInt(r['冠亚和']) % 2 === 1 ? '单' : '双'),
      '组合': rows.map(r => {
        const gy = parseInt(r['冠亚和']);
        const dx = gy > 11 ? '大' : '小';
        const ds = gy % 2 === 1 ? '单' : '双';
        return dx + ds;
      }),
    };
    // 位置号码序列（前5名）
    for (let i = 0; i < this.positionKeys.length; i++) {
      seqs['pos_' + (i + 1)] = rows.map(r => String(r[this.positionKeys[i]]));
    }
    return seqs;
  }

  // v4 新增：提取和值序列（冠亚和）
  extractSumSequence(rows) {
    return rows.map(r => parseInt(r['冠亚和']) || 0);
  }

  // v4 新增：获取和值范围（冠亚和 3~19）
  getSumRange() {
    return { min: 3, max: 19 };
  }

  getLabels(category) {
    if (category === '大小') return ['大', '小'];
    if (category === '单双') return ['单', '双'];
    if (category === '组合') return ['大单', '大双', '小单', '小双'];
    // 位置类别的标签是号码 1-10
    if (category && category.startsWith('pos_')) {
      return this.numberRange.map(String);
    }
    return [];
  }

  getActual(latest, category) {
    const gy = parseInt(latest['冠亚和'] || 0);
    if (category === '大小') return gy > 11 ? '大' : '小';
    if (category === '单双') return gy % 2 ? '单' : '双';
    if (category === '组合') {
      const dx = gy > 11 ? '大' : '小';
      const ds = gy % 2 ? '单' : '双';
      return dx + ds;
    }
    // 位置实际号码
    if (category && category.startsWith('pos_')) {
      const idx = parseInt(category.split('_')[1]) - 1;
      if (idx >= 0 && idx < this.positionKeys.length) {
        return String(latest[this.positionKeys[idx]]);
      }
    }
    return null;
  }

  get positionConfig() {
    return {
      enabled: true,
      positions: this.positionNames.map((name, i) => ({
        name,
        key: 'pos_' + (i + 1),
        seqKey: 'pos_' + (i + 1),
      })),
      topN: Settings.positionTopN || 3,
      numberRange: this.numberRange,
    };
  }

  // v4 新增：组合预测是否启用
  get zuheEnabled() {
    return true;
  }

  renderLive(rt) {
    const nums = POS_COLS.map(p => rt[p]);
    const gy = parseInt(rt['冠亚和']);
    const balls = nums.map(n =>
      '<span class="num-ball gold">' + String(n).padStart(2, '0') + '</span>'
    ).join('');

    return (
      '<div class="title">🔴 ' + this.config.name + ' · 实时开奖</div>' +
      '<div class="meta">第 ' + rt['期号'] + ' 期　' + String(rt['开奖时间']).slice(0, 19) + '</div>' +
      '<div class="balls-row">' + balls + '</div>' +
      '<div style="text-align:center;color:#e8c96a;margin-top:8px;">' +
      '冠亚和 ' + gy + ' · ' + (gy > 11 ? '大' : '小') + ' · ' + (gy % 2 ? '单' : '双') +
      '</div>'
    );
  }

  get predKey() {
    return 'pks_' + this.config.code;
  }

  get defaultCategories() {
    return ['大小', '单双', '组合'];
  }
}

// 工厂函数
function createAdapter(config) {
  if (config.type === 'pks') return new PKSAdapter(config);
  if (config.type === 'luck20') return new Luck20Adapter(config);
  throw new Error('Unknown lottery type: ' + config.type);
}
