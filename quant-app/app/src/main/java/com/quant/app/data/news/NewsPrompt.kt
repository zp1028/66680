package com.quant.app.data.news

/**
 * 新闻情绪分析 prompt 构建器。
 * 输入压缩为编号列表,要求模型按相同顺序输出,服务端按 link 回填。
 */
object NewsPrompt {

    fun buildSystemPrompt(): String = """
        你是一名严谨的加密货币市场情报分析师。
        你只能基于用户消息中提供的新闻标题与摘要判断情绪,禁止编造新闻内容。
        你必须输出 JSON 对象,格式严格如下:
        {"items":[{"link":"新闻链接原文","sentiment":"bullish 或 bearish 或 neutral",
        "score":0到1之间的数字,"category":"监管 或 ETF 或 宏观 或 技术 或 黑客 或 其他",
        "summary":"不超过40字的一句话摘要"}]}
        规则:
        - items 必须包含用户消息中的每一条新闻,link 必须与输入完全一致;
        - bullish=利多币价,bearish=利空币价,无明显影响=neutral;
        - score 表示情绪强度,neutral 时 score 取 0.5 以下;
        - summary 必须基于新闻内容概括,禁止编造。
    """.trimIndent()

    fun buildUserPrompt(items: List<NewsItem>): String = buildString {
        appendLine("请分析以下 ${items.size} 条新闻:")
        items.forEachIndexed { i, item ->
            appendLine("${i + 1}. link=${item.link}")
            appendLine("   title=${item.title}")
            if (item.description.isNotBlank()) {
                appendLine("   summary=${item.description.take(200)}")
            }
        }
        appendLine("按上述 JSON 格式输出分析结果。")
    }
}
