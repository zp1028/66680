package com.quant.app.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.quant.app.data.db.entity.TradeEntity
import com.quant.app.domain.pnl.PnlBySymbolRow
import kotlinx.coroutines.flow.Flow

@Dao
interface TradeDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(trade: TradeEntity)

    @Query("SELECT * FROM trade ORDER BY timestamp DESC")
    fun observeAll(): Flow<List<TradeEntity>>

    @Query("SELECT * FROM trade WHERE symbol = :symbol ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentBySymbol(symbol: String, limit: Int): List<TradeEntity>

    @Query("SELECT * FROM trade WHERE orderId = :orderId")
    suspend fun getByOrderId(orderId: Long): TradeEntity?

    @Query("SELECT * FROM trade WHERE stopLossOrderId = :stopLossOrderId")
    suspend fun getByStopLossOrderId(stopLossOrderId: Long): TradeEntity?

    @Query("UPDATE trade SET status = :status, realizedPnl = :pnl, closedAt = :closedAt, closedPrice = :closedPrice WHERE orderId = :orderId")
    suspend fun markClosed(orderId: Long, status: String, pnl: Double?, closedAt: Long?, closedPrice: Double?)

    /** 汇总统计:总盈亏、胜率。 */
    @Query("SELECT SUM(realizedPnl) FROM trade WHERE realizedPnl IS NOT NULL")
    suspend fun totalRealizedPnl(): Double?

    @Query("SELECT COUNT(*) FROM trade WHERE realizedPnl IS NOT NULL AND realizedPnl > 0")
    suspend fun winCount(): Int

    @Query("SELECT COUNT(*) FROM trade WHERE realizedPnl IS NOT NULL")
    suspend fun closedCount(): Int

    @Query("SELECT MAX(realizedPnl) FROM trade WHERE realizedPnl IS NOT NULL")
    suspend fun maxProfit(): Double?

    @Query("SELECT MIN(realizedPnl) FROM trade WHERE realizedPnl IS NOT NULL")
    suspend fun maxLoss(): Double?

    @Query("SELECT symbol, COALESCE(SUM(realizedPnl), 0) AS pnl, COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END), 0) AS winCnt FROM trade WHERE realizedPnl IS NOT NULL GROUP BY symbol")
    suspend fun pnlBySymbol(): List<PnlBySymbolRow>

    @Query("DELETE FROM trade WHERE timestamp < :beforeTime")
    suspend fun deleteBefore(beforeTime: Long)
}
