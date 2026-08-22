package com.quant.app.domain.predict

import com.quant.app.data.db.entity.TrendPredictionEntity
import com.quant.app.data.network.dto.TrendPredictionDto
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.math.abs

/**
 * 预测校验器:
 * - 破位判定:实际收盘价 < 当日预测价 → 跌破(触发预警);
 * - 到期回测:5 个交易日后比较方向对错,滚动统计预测准确度。
 */
class PredictionValidator {

    private val json = Json { ignoreUnknownKeys = true }

    /** 解析预测点列表。 */
    fun parseForecast(entity: TrendPredictionEntity): List<TrendPredictionDto.DayForecast> =
        runCatching {
            json.decodeFromString<List<TrendPredictionDto.DayForecast>>(entity.forecastJson)
        }.getOrElse { emptyList() }

    /** 预测生成后经过的交易日序号(1..5,超过按 5 计)。 */
    fun dayIndex(generatedAt: Long, now: Long = System.currentTimeMillis()): Int {
        val idx = ((now - generatedAt) / DAY_MS).toInt() + 1
        return idx.coerceIn(1, 5)
    }

    /**
     * 破位判定:当日实际收盘 < 当日预测价 → 跌破。
     * 仅对 up/range 预测有意义;down 预测本身看空,实际价更低不算"跌破预警"。
     */
    fun isBroken(entity: TrendPredictionEntity, actualClose: Double, now: Long = System.currentTimeMillis()): Boolean {
        if (entity.prediction == "down") return false
        val idx = dayIndex(entity.generatedAt, now)
        val forecast = parseForecast(entity).firstOrNull { it.day == idx } ?: return false
        return actualClose < forecast.predictedClose
    }

    /** 到期回测:预测方向 vs 实际方向(5 日后)。 */
    fun evaluateAccuracy(entity: TrendPredictionEntity, finalClose: Double): Double {
        val base = entity.basePrice
        if (base <= 0) return 0.0
        return when (entity.prediction) {
            "up" -> if (finalClose > base) 1.0 else 0.0
            "down" -> if (finalClose < base) 1.0 else 0.0
            else -> if (abs(finalClose - base) / base < 0.02) 1.0 else 0.0
        }
    }

    companion object {
        const val DAY_MS = 86_400_000L
        const val PREDICT_DAYS = 5
    }
}
