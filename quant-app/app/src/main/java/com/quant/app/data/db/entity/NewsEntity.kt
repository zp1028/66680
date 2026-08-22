package com.quant.app.data.db.entity

import androidx.room.Entity
import androidx.room.Index

/**
 * 新闻情报表。
 * link 为主键天然去重;sentiment/score/category 由 DeepSeek 分析后回填。
 */
@Entity(
    tableName = "news",
    primaryKeys = ["link"],
    indices = [Index(value = ["fetchedAt"])],
)
data class NewsEntity(
    val link: String,
    val source: String,
    val title: String,
    val pubTime: Long,
    val content: String,
    val sentiment: String = "neutral",  // bullish / bearish / neutral
    val score: Double = 0.0,            // 0.0 ~ 1.0
    val category: String = "",
    val fetchedAt: Long,
)
