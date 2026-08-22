package com.quant.app.data.ai

import com.quant.app.data.db.entity.KlineEntity
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * DeepSeek Prompt 构建器。
 * 原则:
 * 1. 只允许模型引用输入数据中的数字,禁止编造;
 * 2. 强制 JSON 输出格式(配合 response_format=json_object);
 * 3. 输入压缩为结构化文本,控制 token 成本。
 */
object AiPromptBuilder {

    /** 系统提示:角色、约束、输出格式。 */
    fun buildSystemPrompt(): String = """
        你是一名谨慎的加密货币 USDT 永续合约分析师。
        你只被允许使用用户消息中提供的行情数据进行分析,禁止编造或猜测任何未提供的数据。
        你必须输出 JSON 对象,不要输出任何其他文字,格式严格如下:
        {"direction":"long 或 short 或 neutral","confidence":0到1之间的数字,
         "entry":入场参考价,"stopLoss":止损价,"takeProfit":止盈价,
         "reasons":["简短依据1","简短依据2"],"riskWarning":"风险提示"}
        规则:
        - 没有明确优势时 direction 必须为 neutral,confidence 取较低值;
        - confidence 表示你对方向判断的把握程度,0.5 表示抛硬币;
        - entry/stopLoss/takeProfit 必须来自行情数据的合理范围,禁止随意编造;
        - 做多时 stopLoss 必须低于 entry,做空时 stopLoss 必须高于 entry;
        - takeProfit 与 stopLoss 的比例需考虑风险收益比(建议不低于 1.5:1);
        - reasons 每条不超过 20 个字,riskWarning 必须说明主要风险。
    """.trimIndent()

    /** 用户消息:行情摘要 + 统计指标。extraContext 为可选补充情报(预测/情绪,S9-C 注入)。 */
    fun buildUserPrompt(
        symbol: String,
        interval: String,
        klines: List<KlineEntity>,
        extraContext: String = "",
    ): String {
        require(klines.size >= 2) { "K线数量不足" }

        val sorted = klines.sortedBy { it.openTime }
        val recent = sorted.takeLast(MAX_SHOWN_CANDLES)
        val rows = recent.joinToString("\n") {
            "${it.openTime},${it.open},${it.high},${it.low},${it.close},${it.volume}"
        }

        val closes = sorted.map { it.close }
        val ma20 = closes.takeLast(20).average()
        val ma60 = closes.takeLast(60).average().let { if (closes.size < 60) null else it }
        val firstClose = sorted.first().close
        val lastClose = sorted.last().close
        val change24hPct = if (firstClose != 0.0) (lastClose - firstClose) / firstClose * 100 else 0.0
        val atr14 = atr(sorted.takeLast(15))
        val volatility = stdDev(closes.takeLast(20).map { it / (closes.takeLast(20).firstOrNull() ?: 1.0) - 1.0 })

        return buildString {
            appendLine("交易对: $symbol  周期: $interval")
            appendLine("数据时间范围: ${sorted.first().openTime} ~ ${sorted.last().closeTime}")
            appendLine("最近 ${recent.size} 根K线(openTime,open,high,low,close,volume):")
            append(rows)
            appendLine()
            appendLine("统计指标:")
            appendLine("- MA20=${fmt(ma20)}, MA60=${ma60?.let { fmt(it) } ?: "不足60根"}")
            appendLine("- 近${sorted.size}根K线涨跌幅=${fmt(change24hPct)}%")
            appendLine("- ATR14=${fmt(atr14)}")
            appendLine("- 近20根收益率标准差=${fmt(volatility * 100)}%")
            if (extraContext.isNotBlank()) {
                appendLine("补充情报(仅供参考): $extraContext")
            }
            appendLine("请基于以上数据输出你的分析 JSON。")
        }
    }

    /** ATR(14):平均真实波幅。 */
    private fun atr(klines: List<KlineEntity>): Double {
        if (klines.size < 2) return 0.0
        var sum = 0.0
        for (i in 1 until klines.size) {
            val prev = klines[i - 1]
            val cur = klines[i]
            val tr = maxOf(
                cur.high - cur.low,
                kotlin.math.abs(cur.high - prev.close),
                kotlin.math.abs(cur.low - prev.close),
            )
            sum += tr
        }
        return sum / (klines.size - 1)
    }

    private fun stdDev(values: List<Double>): Double {
        if (values.isEmpty()) return 0.0
        val mean = values.average()
        val variance = values.map { (it - mean).pow(2) }.average()
        return sqrt(variance)
    }

    private fun fmt(v: Double): String = if (v == v.toLong().toDouble()) {
        v.toLong().toString()
    } else {
        "%.4f".format(v)
    }

    private const val MAX_SHOWN_CANDLES = 40
}
