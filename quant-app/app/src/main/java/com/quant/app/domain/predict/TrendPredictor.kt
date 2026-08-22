package com.quant.app.domain.predict

import com.quant.app.data.db.dao.TrendPredictionDao
import com.quant.app.data.db.entity.KlineEntity
import com.quant.app.data.db.entity.TrendPredictionEntity
import com.quant.app.data.network.DeepSeekApiClient
import com.quant.app.data.network.dto.TrendPredictionDto
import com.quant.app.data.repository.SentimentSnapshot
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * AI 预测引擎:抓取行情统计 + 情报情绪 → DeepSeek 自主生成未来 5 个交易日预测线 → 落库。
 * 预测点是"日"级(24h 间隔),与 K线周期无关,便于跨周期统一展示与校验。
 */
class TrendPredictor(
    private val deepSeek: DeepSeekApiClient,
    private val dao: TrendPredictionDao,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * 对某币种生成一次预测。
     * @return 生成的预测记录;数据不足或 AI 失败返回 null(调用方记录日志)。
     */
    suspend fun predict(
        symbol: String,
        interval: String,
        klines: List<KlineEntity>,
        sentiment: SentimentSnapshot,
    ): TrendPredictionEntity? {
        val sorted = klines.sortedBy { it.openTime }
        if (sorted.size < 20) return null
        val stats = buildStats(sorted)
        val dto = deepSeek.analyzeTrend(
            buildSystemPrompt(),
            buildUserPrompt(symbol, interval, stats, sentiment),
        )
        return persist(symbol, interval, sorted.last().close, dto)
    }

    private suspend fun persist(
        symbol: String,
        interval: String,
        basePrice: Double,
        dto: TrendPredictionDto,
    ): TrendPredictionEntity {
        val entity = TrendPredictionEntity(
            symbol = symbol,
            generatedAt = System.currentTimeMillis(),
            interval = interval,
            basePrice = basePrice,
            prediction = dto.prediction,
            confidence = dto.confidence,
            forecastJson = json.encodeToString(dto.dailyForecast),
            keyDriver = dto.keyDriver,
            risks = dto.risks.joinToString(";"),
        )
        dao.insert(entity)
        return entity
    }

    // ---------- Prompt ----------

    private fun buildSystemPrompt(): String = """
        你是一名资深加密货币趋势分析师,擅长将行情统计与市场情报转化为未来一周的走势预测。
        你只能使用用户消息中提供的数据,禁止编造任何数字。
        你必须输出 JSON,格式严格如下:
        {"prediction":"up 或 down 或 range","confidence":0到1之间的数字,
         "daily_forecast":[{"day":1,"predicted_close":价格,"note":"该日驱动"},...共5条],
         "key_driver":"一句话核心驱动因素","risks":["风险1","风险2"]}
        规则:
        - daily_forecast 必须正好 5 条,day 从 1 到 5,代表未来 5 个交易日;
        - predicted_close 以当前价为基准,单日变化一般不超过 ±8%,且必须为正数;
        - 5 个预测点应连成连贯的趋势线(持续上行/下行/区间震荡),不得无理由跳变;
        - prediction 与 daily_forecast 走势必须一致;
        - confidence 表示你对整条预测线的把握程度,0.5 表示接近抛硬币;
        - key_driver 必须来自输入的情报或行情,禁止编造新闻。
    """.trimIndent()

    private fun buildUserPrompt(
        symbol: String,
        interval: String,
        stats: Stats,
        sentiment: SentimentSnapshot,
    ): String = buildString {
        appendLine("交易对: $symbol  当前K线周期: $interval")
        appendLine("当前价: ${fmt(stats.lastClose)}")
        appendLine("近5个交易日收盘价: ${stats.dailyCloses.joinToString(", ") { fmt(it) }}")
        appendLine("5日涨跌幅: ${fmt(stats.change5dPct)}%")
        appendLine("日收益率标准差(波动率): ${fmt(stats.dailyVolPct)}%")
        appendLine("近5日最高: ${fmt(stats.high5d)}  最低: ${fmt(stats.low5d)}")
        appendLine("MA20=${fmt(stats.ma20)}  MA60=${stats.ma60?.let { fmt(it) } ?: "不足"}")
        appendLine("市场情报(${sentiment.total}条已分析): 情绪=${sentiment.label} 利多${sentiment.bullishCount} 利空${sentiment.bearishCount} 中性${sentiment.neutralCount} 情绪均值=${fmt(sentiment.avgScore)}")
        if (sentiment.topKeywords.isNotEmpty()) {
            appendLine("近期新闻标题摘录: ${sentiment.topKeywords.joinToString(" | ")}")
        }
        appendLine("请基于以上数据,输出未来 5 个交易日的预测趋势线 JSON。")
    }

    // ---------- 行情统计 ----------

    private data class Stats(
        val lastClose: Double,
        val dailyCloses: List<Double>,
        val change5dPct: Double,
        val dailyVolPct: Double,
        val high5d: Double,
        val low5d: Double,
        val ma20: Double,
        val ma60: Double?,
    )

    private fun buildStats(klines: List<KlineEntity>): Stats {
        val closes = klines.map { it.close }
        val lastClose = closes.last()
        // 按自然日聚合出"日收盘"
        val daily = klines
            .groupBy { it.openTime / DAY_MS }
            .map { (_, rows) -> rows.maxBy { it.openTime }.close }
            .takeLast(5)

        val base = klines.takeLast(5 * 24).firstOrNull()?.close ?: closes.first()
        val change5d = if (base != 0.0) (lastClose - base) / base * 100 else 0.0

        // 日收益率波动率
        val dailyReturns = daily.mapIndexed { i, c ->
            if (i == 0) 0.0 else (c - daily[i - 1]) / daily[i - 1]
        }
        val vol = if (dailyReturns.size > 1) stdDev(dailyReturns) * 100 else 0.0

        val recent5d = klines.takeLast(5 * 24)
        return Stats(
            lastClose = lastClose,
            dailyCloses = daily,
            change5dPct = change5d,
            dailyVolPct = vol,
            high5d = recent5d.maxOf { it.high },
            low5d = recent5d.minOf { it.low },
            ma20 = closes.takeLast(20).average(),
            ma60 = closes.takeLast(60).average().let { if (closes.size < 60) null else it },
        )
    }

    private fun stdDev(values: List<Double>): Double {
        if (values.isEmpty()) return 0.0
        val mean = values.average()
        return sqrt(values.map { (it - mean).pow(2) }.average())
    }

    private fun fmt(v: Double): String = if (v == v.toLong().toDouble()) {
        v.toLong().toString()
    } else {
        "%.4f".format(v)
    }

    private companion object {
        const val DAY_MS = 86_400_000L
    }
}
