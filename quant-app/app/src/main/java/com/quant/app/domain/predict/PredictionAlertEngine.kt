package com.quant.app.domain.predict

import com.quant.app.data.db.dao.TrendPredictionDao
import com.quant.app.data.db.entity.TrendPredictionEntity
import com.quant.app.data.network.DeepSeekApiClient
import com.quant.app.data.network.websocket.KlineStreamEvent
import com.quant.app.data.repository.KlineRepository
import com.quant.app.data.repository.NewsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 预警联动引擎(S9-C):
 * - 每根 K线收盘:破位检测(实际收盘 < 当日预测价)→ AI 解读 → 通知 → 标记 broken(天然冷却);
 * - 预测到期(5 个交易日后)回测准确度;
 * - 每个币种每 24h 自动生成一次新预测;
 * - 提供 [signalContext] 将预测状态注入 AI 信号 prompt。
 */
class PredictionAlertEngine(
    private val predictor: TrendPredictor,
    private val validator: PredictionValidator,
    private val dao: TrendPredictionDao,
    private val klineRepository: KlineRepository,
    private val newsRepository: NewsRepository,
    private val deepSeek: DeepSeekApiClient,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    /** 预警回调(由宿主设置:发通知)。参数:title, text。 */
    var onAlert: ((String, String) -> Unit)? = null

    private val lastPredictAt = HashMap<String, Long>()

    /** K线收盘入口(TradingService 调用)。 */
    suspend fun onKlineClosed(event: KlineStreamEvent) {
        // 1. 校验现有预测
        val latest = dao.getLatest(event.symbol)
        if (latest != null && latest.status == "active") {
            val close = klineRepository.getRecent(event.symbol, event.interval, 1).lastOrNull()?.close
            if (close != null) {
                if (validator.isBroken(latest, close)) {
                    handleBreakout(latest, close)
                } else {
                    maybeBacktest(latest, close)
                }
            }
        }
        // 2. 定时生成新预测(每 24h 一次/币种)
        maybeGenerate(event.symbol, event.interval)
    }

    /** 主动生成一次预测(UI 手动刷新调用)。 */
    suspend fun generatePrediction(symbol: String, interval: String) {
        val klines = klineRepository.getRecent(symbol, interval, 200)
        if (klines.size < 20) return
        val sentiment = newsRepository.sentimentSnapshot()
        runCatching {
            predictor.predict(symbol, interval, klines, sentiment)
        }.onFailure { e ->
            android.util.Log.w(TAG, "生成预测失败 $symbol: ${e.message}")
        }
    }

    private suspend fun maybeGenerate(symbol: String, interval: String) {
        val now = System.currentTimeMillis()
        val last = lastPredictAt[symbol] ?: 0L
        if (now - last < PREDICT_INTERVAL_MS) return
        lastPredictAt[symbol] = now
        generatePrediction(symbol, interval)
    }

    /** 破位处理:AI 解读 → 标记 broken → 回调通知。 */
    private suspend fun handleBreakout(entity: TrendPredictionEntity, actualClose: Double) {
        val sentiment = newsRepository.sentimentSnapshot()
        val note = runCatching {
            deepSeek.analyzeBreakout(
                BREAKOUT_SYSTEM_PROMPT,
                buildBreakoutPrompt(entity, actualClose, sentiment.label),
            ).interpretation
        }.getOrElse { "AI 预测趋势线被跌破,请关注风险" }

        dao.markBroken(
            symbol = entity.symbol,
            generatedAt = entity.generatedAt,
            status = "broken",
            brokenAt = System.currentTimeMillis(),
            note = note,
        )
        onAlert?.invoke(
            "趋势线跌破 · ${entity.symbol}",
            "AI预测(${predLabel(entity.prediction)} 置信度${(entity.confidence * 100).toInt()}%)被跌破,实际收盘 $actualClose。\n$note",
        )
    }

    /** 预测到期后回测准确度。 */
    private suspend fun maybeBacktest(entity: TrendPredictionEntity, latestClose: Double) {
        val elapsed = System.currentTimeMillis() - entity.generatedAt
        if (elapsed < PREDICT_DAYS * DAY_MS) return
        val acc = validator.evaluateAccuracy(entity, latestClose)
        dao.updateAccuracy(entity.symbol, entity.generatedAt, acc)
    }

    /** 滚动预测准确度统计(近 20 条已回测)。 */
    suspend fun accuracyStats(limit: Int = 20): AccuracyStats {
        val recent = dao.getRecent(limit)
        val backtested = recent.filter { it.accuracy != null }
        if (backtested.isEmpty()) return AccuracyStats(0, 0, 0.0)
        val correct = backtested.count { it.accuracy == 1.0 }
        return AccuracyStats(
            total = backtested.size,
            correct = correct,
            rate = correct.toDouble() / backtested.size,
        )
    }

    /** 注入 AI 信号 prompt 的预测上下文。 */
    suspend fun signalContext(symbol: String): String {
        val latest = dao.getLatest(symbol) ?: return ""
        if (latest.status != "active") {
            return "(该币种 AI 一周预测线已跌破:${latest.breakNote.take(30)})"
        }
        val forecast = validator.parseForecast(latest)
        val today = forecast.firstOrNull { it.day == validator.dayIndex(latest.generatedAt) }
        val todayText = today?.let { "今日预测价=${fmt(it.predictedClose)}" } ?: ""
        return "AI一周预测:方向=${predLabel(latest.prediction)} 置信度=${(latest.confidence * 100).toInt()}% $todayText 核心驱动=${latest.keyDriver}"
    }

    private fun buildBreakoutPrompt(entity: TrendPredictionEntity, actualClose: Double, sentimentLabel: String): String = """
        ${entity.symbol} 的 AI 一周预测趋势线被跌破:
        - 预测方向: ${predLabel(entity.prediction)}, 置信度 ${(entity.confidence * 100).toInt()}%
        - 实际收盘价: $actualClose, 当前市场情绪: $sentimentLabel
        - 核心驱动: ${entity.keyDriver}
        请用不超过 80 字解释可能原因,并给出客观建议(是否减仓/观望)。
        输出 JSON: {"interpretation":"..."}
    """.trimIndent()

    private fun predLabel(p: String): String = when (p) {
        "up" -> "看涨"
        "down" -> "看跌"
        else -> "震荡"
    }

    private fun fmt(v: Double): String = if (v == v.toLong().toDouble()) {
        v.toLong().toString()
    } else {
        "%.4f".format(v)
    }

    companion object {
        private const val TAG = "PredictionAlertEngine"
        private const val PREDICT_INTERVAL_MS = 24L * 60 * 60 * 1000
        const val PREDICT_DAYS = 5
        const val DAY_MS = 86_400_000L

        private val BREAKOUT_SYSTEM_PROMPT = """
            你是一名冷静的加密货币风险解读分析师。
            你只能基于用户消息中提供的事实解读,禁止编造。
            输出必须为 JSON: {"interpretation":"不超过80字的解读与建议"}。
        """.trimIndent()
    }
}

/** 滚动回测统计。 */
data class AccuracyStats(
    val total: Int,
    val correct: Int,
    val rate: Double,
) {
    val label: String
        get() = if (total == 0) "暂无回测数据" else "准确率 ${(rate * 100).toInt()}%(${correct}/$total)"
}
