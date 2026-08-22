package com.quant.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.quant.app.data.db.dao.AiAnalysisDao
import com.quant.app.data.db.dao.KlineDao
import com.quant.app.data.db.dao.NewsDao
import com.quant.app.data.db.dao.TradeDao
import com.quant.app.data.db.dao.TrendPredictionDao
import com.quant.app.data.db.entity.AiAnalysisEntity
import com.quant.app.data.db.entity.KlineEntity
import com.quant.app.data.db.entity.NewsEntity
import com.quant.app.data.db.entity.TradeEntity
import com.quant.app.data.db.entity.TrendPredictionEntity

@Database(
    entities = [
        KlineEntity::class,
        TradeEntity::class,
        AiAnalysisEntity::class,
        NewsEntity::class,
        TrendPredictionEntity::class,
    ],
    version = 4,
    exportSchema = false,
)
abstract class QuantDatabase : RoomDatabase() {

    abstract fun klineDao(): KlineDao
    abstract fun tradeDao(): TradeDao
    abstract fun aiAnalysisDao(): AiAnalysisDao
    abstract fun newsDao(): NewsDao
    abstract fun trendPredictionDao(): TrendPredictionDao

    companion object {
        private const val DB_NAME = "quant.db"

        @Volatile
        private var instance: QuantDatabase? = null

        fun get(context: Context): QuantDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    QuantDatabase::class.java,
                    DB_NAME,
                )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { instance = it }
            }
    }
}
