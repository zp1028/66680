package com.quant.app.domain.pnl

import androidx.room.ColumnInfo

/** Room 按币种汇总查询结果行。 */
data class PnlBySymbolRow(
    @ColumnInfo(name = "symbol") val symbol: String,
    @ColumnInfo(name = "pnl") val pnl: Double,
    @ColumnInfo(name = "cnt") val cnt: Int,
    @ColumnInfo(name = "winCnt") val winCnt: Int,
)

/** 单币种盈亏汇总。 */
data class SymbolPnl(
    val symbol: String,
    val realizedPnl: Double,
    val closedCount: Int,
    val winCount: Int,
) {
    val winRate: Double get() = if (closedCount > 0) winCount.toDouble() / closedCount else 0.0
}

/** 全局盈亏汇总。 */
data class PnlSummary(
    val totalRealizedPnl: Double,
    val closedCount: Int,
    val winCount: Int,
    val winRate: Double,
    val maxProfit: Double,
    val maxLoss: Double,
    val bySymbol: List<SymbolPnl>,
) {
    val lossCount: Int get() = closedCount - winCount
}
