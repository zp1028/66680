# v5.4 更新日志 - P值统一 + 冷热遗漏模型

## 🔥 核心更新

### 1. P值计算全面统一修复
- **问题**：预测卡p值与实验室排名p值计算方式不一致
- **方案**：全链路统一使用二项检验（Binomial Test）方法论
- **覆盖范围**：
  - `singlePatternModel` - 单形态模型p值
  - `predictFrequency` - 频率模型p值
  - `adaptivePatternModel` - 自适应集成模型p值（加权融合）
  - `predictZuheEnhanced` - 组合增强模型p值
  - `predictWithEWMA` - EWMA加权模型p值
  - 高级模型库全部5个模型（马尔可夫、贝叶斯、加权频率、位置分布、多尺度）
  - `FusionPredictor` - 智能融合预测器p值（按权重加权几何平均）
  - `PatternPredictor` / `ExperiencePredictor` / `ManualMarkPredictor` - 三大预测器p值

### 2. 新增：冷热遗漏模型（ColdHotOmissionModel）🌡️
- **独立模型**：与其他模型完全分开，作为第6个高级模型
- **核心原理**：
  - **遗漏分析**：统计每个标签距离上次出现的期数
  - **冷热转换**：基于S型函数，遗漏越久回补概率越高（均值回归理论）
  - **随机变量**：加入可控强度的随机扰动，避免过拟合，增加预测多样性
- **随机数生成器**：Mulberry32算法，支持种子复现
- **全场景支持**：
  - ✅ 大小预测
  - ✅ 单双预测
  - ✅ 组合预测（大单/大双/小单/小双）
  - ✅ 位置号码预测（冷热号分析）
- **可调参数**：
  - `randomStrength`：随机扰动强度（默认0.15）
  - `omitBoostFactor`：遗漏增强系数（默认0.8）
  - `window`：统计窗口（默认50期）
  - `seed`：随机种子（可选，用于复现）
- **输出数据**：
  - 当前遗漏期数
  - 历史平均遗漏
  - 冷号/热号标签列表
  - 最大遗漏值

## 📁 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `js/engine.js` | 新增`computePValueFromDist`通用工具；`adaptivePatternModel`添加p值融合 |
| `js/advanced_models.js` | 5个高级模型全部添加p值；新增`ColdHotOmissionModel`类；注册到`ADVANCED_MODELS` |
| `js/fusion.js` | `FusionPredictor`添加p值融合；默认模型列表加入`coldHotOmission` |
| `js/predictors.js` | 三大预测器p值融合方法（已有，确认完整性） |
| `index.html` | 版本号更新为v5.4 |

## 🔧 技术细节

### P值融合算法
采用**加权几何平均**（Weighted Geometric Mean），本质是Fisher方法的简化版：
```
p_fused = exp( (Σ w_i * ln(p_i)) / Σ w_i )
```
- 优点：天然满足p值的0~1范围，权重越高影响越大
- 适用：多模型p值融合、多子模型p值融合

### 冷热遗漏概率计算
```
omitBoost = sigmoid( factor × (currentOmit / avgOmit - 1) )
prob = baseline × (1 + omitBoost × factor)
```
再叠加随机扰动后归一化。

## 📊 模型列表（v5.4）

| 模型ID | 名称 | 类别 | 新增版本 |
|--------|------|------|----------|
| markov1 | 马尔可夫链 | 时序模型 | v5.2 |
| markov2 | 二阶马尔可夫 | 时序模型 | v5.2 |
| bayesian | 贝叶斯平滑 | 统计模型 | v5.2 |
| weightedFreq | 加权频率 | 频率模型 | v5.2 |
| multiScale | 多尺度频率 | 频率模型 | v5.2 |
| **coldHotOmission** | **冷热遗漏** | **遗漏模型** | **v5.4 🌟** |
