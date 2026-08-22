package com.quant.app.data.network.dto

import kotlinx.serialization.Serializable

/**
 * 新闻情绪分析输出(DeepSeek 批量分析)。
 * 模型按输入顺序对每条新闻输出情绪标签,服务端按 link 匹配回填。
 */
@Serializable
data class NewsAnalysisDto(
    val items: List<Item> = emptyList(),
) {
    @Serializable
    data class Item(
        val link: String = "",
        val sentiment: String = "neutral",   // bullish / bearish / neutral
        val score: Double = 0.0,             // 0.0 ~ 1.0
        val category: String = "",           // 监管/ETF/宏观/技术/黑客/其他
        val summary: String = "",            // 一句话摘要(≤40字)
    )
}
