package com.quant.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** DeepSeek Chat Completions 请求(OpenAI 兼容)。 */
@Serializable
data class DeepSeekChatRequest(
    val model: String = "deepseek-chat",
    @SerialName("response_format") val responseFormat: ResponseFormat = ResponseFormat(),
    val temperature: Double = 0.3,
    val messages: List<Message>,
    /** 单次最多生成 token,防止成本失控。 */
    @SerialName("max_tokens") val maxTokens: Int = 1200,
) {
    @Serializable
    data class ResponseFormat(val type: String = "json_object")

    @Serializable
    data class Message(val role: String, val content: String)
}

@Serializable
data class DeepSeekChatResponse(
    val choices: List<Choice> = emptyList(),
    val usage: Usage? = null,
) {
    @Serializable
    data class Choice(
        val message: Message,
        @SerialName("finish_reason") val finishReason: String,
    ) {
        @Serializable
        data class Message(val content: String)
    }

    @Serializable
    data class Usage(
        @SerialName("total_tokens") val totalTokens: Int = 0,
    )
}

/** AI 分析输出(严格 JSON,由 prompt 约束 + 解析校验双层保障)。 */
@Serializable
data class AiSignalDto(
    val direction: String = "neutral",   // long / short / neutral
    val confidence: Double = 0.0,        // 0.0 ~ 1.0
    val entry: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null,
    val reasons: List<String> = emptyList(),
    val riskWarning: String = "",
) {
    val isValid: Boolean
        get() = direction in setOf("long", "short", "neutral") &&
            confidence in 0.0..1.0
}
