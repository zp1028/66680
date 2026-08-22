package com.quant.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * AI 预测趋势线输出(DeepSeek)。
 * 以当前价为起点,预测未来 5 个交易日的收盘价,连线即预测趋势线。
 */
@Serializable
data class TrendPredictionDto(
    val prediction: String = "range",              // up / down / range
    val confidence: Double = 0.0,                  // 0.0 ~ 1.0
    @SerialName("daily_forecast")
    val dailyForecast: List<DayForecast> = emptyList(),
    @SerialName("key_driver")
    val keyDriver: String = "",
    val risks: List<String> = emptyList(),
) {
    @Serializable
    data class DayForecast(
        val day: Int = 0,
        @SerialName("predicted_close")
        val predictedClose: Double = 0.0,
        val note: String = "",
    )

    val isValid: Boolean
        get() = prediction in setOf("up", "down", "range") &&
            confidence in 0.0..1.0 &&
            dailyForecast.isNotEmpty() &&
            dailyForecast.all { it.predictedClose > 0 }
}

/** 趋势线破位 AI 解读输出。 */
@Serializable
data class BreakoutDto(
    val interpretation: String = "",
) {
    val isValid: Boolean get() = interpretation.isNotBlank()
}
