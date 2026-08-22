package com.quant.app.data.db.entity

import androidx.room.Entity
import androidx.room.Index

/**
 * 币安合约 K线缓存表。
 * 同一 (symbol, interval, openTime) 唯一,插入采用 REPLACE 防重。
 */
@Entity(
    tableName = "kline",
    primaryKeys = ["symbol", "interval", "openTime"],
    indices = [Index(value = ["symbol", "interval", "openTime"], unique = true)]
)
data class KlineEntity(
    val symbol: String,
    val interval: String,
    val openTime: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val closeTime: Long,
)
