package com.quant.app.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.quant.app.data.db.entity.TrendPredictionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TrendPredictionDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(prediction: TrendPredictionEntity)

    @Query("SELECT * FROM trend_prediction WHERE symbol = :symbol ORDER BY generatedAt DESC LIMIT 1")
    suspend fun getLatest(symbol: String): TrendPredictionEntity?

    @Query("SELECT * FROM trend_prediction WHERE symbol = :symbol ORDER BY generatedAt DESC LIMIT 1")
    fun observeLatest(symbol: String): Flow<TrendPredictionEntity?>

    @Query("SELECT * FROM trend_prediction WHERE status = 'active'")
    suspend fun getActive(): List<TrendPredictionEntity>

    @Query("SELECT * FROM trend_prediction ORDER BY generatedAt DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<TrendPredictionEntity>>

    @Query("SELECT * FROM trend_prediction ORDER BY generatedAt DESC LIMIT :limit")
    suspend fun getRecent(limit: Int): List<TrendPredictionEntity>

    @Query("UPDATE trend_prediction SET status = :status, brokenAt = :brokenAt, breakNote = :note WHERE symbol = :symbol AND generatedAt = :generatedAt")
    suspend fun markBroken(symbol: String, generatedAt: Long, status: String, brokenAt: Long?, note: String)

    @Query("UPDATE trend_prediction SET accuracy = :accuracy WHERE symbol = :symbol AND generatedAt = :generatedAt")
    suspend fun updateAccuracy(symbol: String, generatedAt: Long, accuracy: Double)

    @Query("SELECT * FROM trend_prediction WHERE generatedAt < :beforeTime AND status != 'active'")
    suspend fun getExpiredBefore(beforeTime: Long): List<TrendPredictionEntity>

    @Query("DELETE FROM trend_prediction WHERE generatedAt < :beforeTime")
    suspend fun deleteBefore(beforeTime: Long)
}
