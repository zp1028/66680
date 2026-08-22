package com.quant.app.data.db.entity

import androidx.room.Entity
import androidx.room.Index

/**
 * AI 预测趋势线记录。
 * 每次交易日收盘后生成(或手动刷新);status=active 表示预测有效,
 * 实际价格跌破当日预测值后置为 broken 并记录 brokenAt。
 */
@Entity(
    tableName = "trend_prediction",
    primaryKeys = ["symbol", "generatedAt"],
    indices = [Index(value = ["symbol", "generatedAt"])],
)
data class TrendPredictionEntity(
    val symbol: String,
    val generatedAt: Long,
    val interval: String,
    val basePrice: Double,          // 预测起点(生成时价格)
    val prediction: String,         // up / down / range
    val confidence: Double,
    val forecastJson: String,       // daily_forecast 数组 JSON
    val keyDriver: String,
    val risks: String,              // 逗号分隔
    val status: String = "active",  // active / broken
    val brokenAt: Long? = null,
    /** AI 破位解读(S9-C 回填)。 */
    val breakNote: String = "",
    /** 回测结果:方向判断对=1 / 错=0 / 未到期=null。 */
    val accuracy: Double? = null,
)
