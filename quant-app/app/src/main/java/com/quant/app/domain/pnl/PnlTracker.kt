package com.quant.app.domain.pnl

import com.quant.app.data.config.ConfigStore
import com.quant.app.data.db.dao.TradeDao
import com.quant.app.data.network.BinanceApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * 盈亏统计引擎:
 * - 定时拉取币安成交明细(userTrades),按订单聚合已实现盈亏;
 * - 匹配止损单成交,回填 TradeEntity(标记已平仓 + 盈亏);
 * - 提供全局/按币种汇总。
 */
class PnlTracker(
    private val api: BinanceApiClient,
    private val tradeDao: TradeDao,
    private val configStore: ConfigStore,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private var job: Job? = null

    fun start(intervalMs: Long = DEFAULT_INTERVAL_MS) {
        stop()
        job = scope.launch {
            while (isActive) {
                runCatching { sync() }
                    .onFailure { e -> android.util.Log.w(TAG, "盈亏同步失败: ${e.message}") }
                delay(intervalMs)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    fun release() {
        stop()
        scope.cancel()
    }

    /** 拉取成交明细并回填已实现盈亏。 */
    suspend fun sync() {
        val symbols = configStore.load().symbols
        symbols.forEach { symbol ->
            runCatching { syncSymbol(symbol) }
                .onFailure { e -> android.util.Log.w(TAG, "$symbol 成交同步失败: ${e.message}") }
        }
    }

    private suspend fun syncSymbol(symbol: String) {
        val trades = api.userTrades(symbol, 50)
        trades.groupBy { it.orderId }.forEach { (orderId, fills) ->
            val totalPnl = fills.sumOf { it.realizedPnl.toDoubleOrNull() ?: 0.0 }
            // 仅当该订单是某笔交易的止损单且尚未回填时处理
            val stopTrade = tradeDao.getByStopLossOrderId(orderId) ?: return@forEach
            if (stopTrade.realizedPnl != null) return@forEach
            val closedPrice = fills.lastOrNull()?.price?.toDoubleOrNull()
            tradeDao.markClosed(
                orderId = stopTrade.orderId,
                status = "STOPPED",
                pnl = totalPnl,
                closedAt = System.currentTimeMillis(),
                closedPrice = closedPrice,
            )
            android.util.Log.i(TAG, "回填止损盈亏: ${stopTrade.symbol} PnL=$totalPnl")
        }
    }

    /** 全局盈亏汇总。 */
    suspend fun summary(): PnlSummary {
        val total = tradeDao.totalRealizedPnl() ?: 0.0
        val win = tradeDao.winCount()
        val closed = tradeDao.closedCount()
        val winRate = if (closed > 0) win.toDouble() / closed else 0.0
        val maxProfit = tradeDao.maxProfit() ?: 0.0
        val maxLoss = tradeDao.maxLoss() ?: 0.0
        val bySymbol = tradeDao.pnlBySymbol().map {
            SymbolPnl(
                symbol = it.symbol,
                realizedPnl = it.pnl,
                closedCount = it.cnt,
                winCount = it.winCnt,
            )
        }
        return PnlSummary(
            totalRealizedPnl = total,
            closedCount = closed,
            winCount = win,
            winRate = winRate,
            maxProfit = maxProfit,
            maxLoss = maxLoss,
            bySymbol = bySymbol,
        )
    }

    companion object {
        private const val TAG = "PnlTracker"
        private const val DEFAULT_INTERVAL_MS = 15 * 60 * 1000L
    }
}
