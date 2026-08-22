package com.quant.app.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.quant.app.data.db.entity.KlineEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface KlineDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(klines: List<KlineEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(kline: KlineEntity)

    /** 取某币种某周期最近的 N 根 K线(升序)。 */
    @Query(
        """
        SELECT * FROM kline
        WHERE symbol = :symbol AND interval = :interval
        ORDER BY openTime DESC
        LIMIT :limit
        """
    )
    suspend fun getRecentDesc(symbol: String, interval: String, limit: Int): List<KlineEntity>

    /** 实时观察最近 N 根 K线(升序)。 */
    @Query(
        """
        SELECT * FROM kline
        WHERE symbol = :symbol AND interval = :interval
        ORDER BY openTime DESC
        LIMIT :limit
        """
    )
    fun observeRecent(symbol: String, interval: String, limit: Int): Flow<List<KlineEntity>>

    /** 取某时间点之后的 K线(用于增量同步)。 */
    @Query(
        """
        SELECT * FROM kline
        WHERE symbol = :symbol AND interval = :interval AND openTime >= :fromTime
        ORDER BY openTime ASC
        """
    )
    suspend fun getSince(symbol: String, interval: String, fromTime: Long): List<KlineEntity>

    @Query("SELECT COUNT(*) FROM kline WHERE symbol = :symbol AND interval = :interval")
    suspend fun count(symbol: String, interval: String): Int

    @Query("DELETE FROM kline WHERE symbol = :symbol AND interval = :interval AND openTime < :beforeTime")
    suspend fun deleteBefore(symbol: String, interval: String, beforeTime: Long)
}
