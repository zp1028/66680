package com.quant.app.domain.trade

import com.quant.app.data.config.ConfigStore
import com.quant.app.data.network.BinanceApiClient
import com.quant.app.data.network.dto.AccountDto
import java.util.Calendar

/**
 * 风控管理器。
 * 职责:
 * - 当日亏损熔断(以账户钱包余额为基准,跨天自动重置);
 * - 开仓数量计算(单笔保证金上限 × 杠杆);
 * - 数量精度(来自 exchangeInfo 的 quantityPrecision)。
 */
class RiskManager(
    private val configStore: ConfigStore,
    private val api: BinanceApiClient,
) {
    private var baselineDayKey: String? = null
    private var baselineWalletBalance: Double? = null
    private var precisionCache: MutableMap<String, Int> = mutableMapOf()

    private val config get() = configStore.load()

    /**
     * 检查当日亏损是否触发熔断。
     * 首次调用(或跨天)记录当日基准余额。
     */
    suspend fun checkCircuitBreaker(account: AccountDto): CircuitBreakerResult {
        val today = todayKey()
        val wallet = account.totalWalletBalance.toDoubleOrNull() ?: return CircuitBreakerResult(false, 0.0)

        if (baselineDayKey != today) {
            baselineDayKey = today
            baselineWalletBalance = wallet
        }
        val baseline = baselineWalletBalance ?: wallet
        val lossPct = if (baseline > 0) (baseline - wallet) / baseline * 100 else 0.0
        val triggered = lossPct >= config.maxDailyLossPct
        return CircuitBreakerResult(triggered = triggered, lossPct = lossPct)
    }

    /**
     * 按单笔保证金上限与杠杆计算开仓数量。
     * 数量 = (maxPositionUsd × leverage) / entryPrice,
     * 并按交易所 quantityPrecision 截断。
     */
    suspend fun computeQuantity(symbol: String, entryPrice: Double): String {
        if (entryPrice <= 0.0) return "0"
        val precision = quantityPrecision(symbol)
        val rawQty = config.maxPositionUsd * config.leverage / entryPrice
        val factor = Math.pow(10.0, precision.toDouble())
        val truncated = Math.floor(rawQty * factor) / factor
        return String.format("%.${precision}f", truncated)
    }

    /** 获取 quantityPrecision(缓存 exchangeInfo)。 */
    suspend fun quantityPrecision(symbol: String): Int =
        precisionCache.getOrPut(symbol) {
            runCatching {
                api.exchangeInfo().symbols.firstOrNull { it.symbol == symbol }?.quantityPrecision
            }.getOrNull() ?: 8
        }

    private fun todayKey(): String {
        val cal = Calendar.getInstance()
        return "%d-%02d-%02d".format(cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))
    }

    data class CircuitBreakerResult(val triggered: Boolean, val lossPct: Double)
}
