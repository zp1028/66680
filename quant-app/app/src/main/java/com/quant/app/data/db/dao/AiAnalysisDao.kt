package com.quant.app.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.quant.app.data.db.entity.AiAnalysisEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface AiAnalysisDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(analysis: AiAnalysisEntity): Long

    @Query("SELECT * FROM ai_analysis ORDER BY timestamp DESC")
    fun observeAll(): Flow<List<AiAnalysisEntity>>

    @Query("SELECT * FROM ai_analysis ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecent(limit: Int): List<AiAnalysisEntity>

    @Query("SELECT * FROM ai_analysis WHERE symbol = :symbol ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentBySymbol(symbol: String, limit: Int): List<AiAnalysisEntity>

    @Query("DELETE FROM ai_analysis WHERE timestamp < :beforeTime")
    suspend fun deleteBefore(beforeTime: Long)
}
