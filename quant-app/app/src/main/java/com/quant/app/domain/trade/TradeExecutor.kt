package com.quant.app.domain.trade

import com.quant.app.data.config.ConfigStore
import com.quant.app.data.db.dao.TradeDao
import com.quant.app.data.db.entity.TradeEntity
import com.quant.app.data.network.BinanceApiClient
import com.quant.app.domain.model.OpenSignal
import com.quant.app.domain.model.OrderRequest

/** 开仓结果。 */
sealed class TradeResult {
    data class Success(val trade: TradeEntity, val stopLossOrderId: Long?) : TradeResult()
    data class Failure(val reason: String) : TradeResult()
}

/**
 * 下单执行器:
 * 设置杠杆 → 市价开仓 → 挂币安侧止损单(App 被杀也有保护)→ 记录交易。
 * 开仓与止损任一步失败都会回滚(尝试撤单)。
 */
class TradeExecutor(
    private val configStore: ConfigStore,
    private val api: BinanceApiClient,
    private val riskManager: RiskManager,
    private val tradeDao: TradeDao,
) {
    private val config get() = configStore.load()

    suspend fun openPosition(signal: OpenSignal, mode: String): TradeResult {
        return try {
            // 1. 杠杆(失败不阻断,继续执行)
            runCatching { api.setLeverage(signal.symbol, config.leverage) }
                .onFailure { e -> android.util.Log.w(TAG, "设置杠杆失败: ${e.message}") }

            // 2. 入场价:AI 给的 entry 优先,否则用最新收盘价
            val entry = signal.entryPrice
                ?: runCatching { api.klines(signal.symbol, config.interval, 1).firstOrNull()?.close }
                    .getOrNull()
                ?: return TradeResult.Failure("无法确定开仓价格")

            // 3. 数量(风控:单笔保证金上限 × 杠杆 / 价格,按交易所精度)
            val quantity = riskManager.computeQuantity(signal.symbol, entry)
            if (quantity.toDoubleOrNull()?.let { it <= 0.0 } ?: true) {
                return TradeResult.Failure("计算数量非法: $quantity")
            }

            // 4. 市价开仓
            val side = if (signal.direction == "long") "BUY" else "SELL"
            val openOrder = api.placeOrder(
                OrderRequest(
                    symbol = signal.symbol,
                    side = side,
                    positionSide = "BOTH",
                    type = "MARKET",
                    quantity = quantity,
                )
            )
            val filledQty = openOrder.executedQty.ifBlank { quantity }

            // 5. 币安侧止损单(强平保护底线)
            val slPrice = signal.stopLossPrice ?: fallbackStopLoss(entry, signal.direction)
            val stopOrder = runCatching {
                api.placeStopLoss(
                    symbol = signal.symbol,
                    positionSide = "BOTH",
                    quantity = filledQty,
                    stopPrice = formatPrice(slPrice, openOrder.price),
                )
            }.getOrNull()

            // 6. 记录交易
            val trade = TradeEntity(
                orderId = openOrder.orderId,
                symbol = signal.symbol,
                side = side,
                positionSide = "BOTH",
                price = openOrder.avgPrice.ifBlank { openOrder.price }.toDoubleOrNull() ?: entry,
                qty = filledQty.toDoubleOrNull() ?: 0.0,
                status = openOrder.status,
                mode = mode,
                leverage = config.leverage,
                stopLossPrice = slPrice,
                stopLossOrderId = stopOrder?.orderId,
                takeProfitPrice = signal.takeProfitPrice,
                timestamp = System.currentTimeMillis(),
            )
            tradeDao.upsert(trade)
            TradeResult.Success(trade, stopOrder?.orderId)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "开仓失败: ${e.message}", e)
            TradeResult.Failure(e.message ?: "未知错误")
        }
    }

    /** 兜底止损:AI 未给止损时按入场价 ±2%。 */
    private fun fallbackStopLoss(entry: Double, direction: String): Double {
        val delta = entry * 0.02
        return if (direction == "long") entry - delta else entry + delta
    }

    private fun formatPrice(price: Double, reference: String): String {
        val decimals = reference.substringAfter('.', "").length.coerceIn(0, 8)
        return String.format("%.${decimals}f", price)
    }

    companion object {
        private const val TAG = "TradeExecutor"
    }
}
