package com.quant.app.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 交易订单记录(含实盘与测试网)。
 * mode 取值:AUTO(自动下单)/ MANUAL(人工确认下单)。
 */
@Entity(tableName = "trade")
data class TradeEntity(
    @PrimaryKey val orderId: Long,
    val symbol: String,
    val side: String,        // BUY / SELL
    val positionSide: String, // LONG / SHORT(双向持仓模式下)
    val price: Double,
    val qty: Double,
    val status: String,      // NEW / FILLED / PARTIALLY_FILLED / CANCELED / REJECTED / EXPIRED / STOPPED
    val mode: String,        // AUTO / MANUAL
    val leverage: Int,
    val stopLossPrice: Double?,
    val stopLossOrderId: Long? = null,  // 币安侧止损单 ID,用于监听成交
    val takeProfitPrice: Double?,
    val timestamp: Long,
    /** 已实现盈亏(回填后更新)。 */
    val realizedPnl: Double? = null,
    val closedAt: Long? = null,
    val closedPrice: Double? = null,
)
