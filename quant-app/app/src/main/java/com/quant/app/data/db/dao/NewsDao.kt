package com.quant.app.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.quant.app.data.db.entity.NewsEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface NewsDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(items: List<NewsEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun update(item: NewsEntity)

    @Query("SELECT * FROM news ORDER BY pubTime DESC LIMIT :limit")
    suspend fun getRecent(limit: Int): List<NewsEntity>

    @Query("SELECT * FROM news ORDER BY pubTime DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<NewsEntity>>

    /** 最近一批需要情绪分析(score=0 且 sentiment=neutral 视为未分析)。 */
    @Query("SELECT * FROM news WHERE sentiment = 'neutral' AND score = 0 ORDER BY fetchedAt DESC LIMIT :limit")
    suspend fun getUnanalyzed(limit: Int): List<NewsEntity>

    @Query("SELECT COUNT(*) FROM news")
    suspend fun count(): Int

    @Query("DELETE FROM news WHERE fetchedAt < :beforeTime")
    suspend fun deleteBefore(beforeTime: Long)
}
