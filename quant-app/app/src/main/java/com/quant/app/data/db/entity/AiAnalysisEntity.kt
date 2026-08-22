package com.quant.app.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * AI 分析记录。每次 DeepSeek 调用落库一条,用于历史查看与信号复盘。
 * direction 取值:long / short / neutral。
 */
@Entity(tableName = "ai_analysis")
data class AiAnalysisEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val symbol: String,
    val interval: String,
    val inputSummary: String,
    val outputJson: String,
    val direction: String,
    val confidence: Double,
    val entry: Double?,
    val stopLoss: Double?,
    val takeProfit: Double?,
    val timestamp: Long,
)
