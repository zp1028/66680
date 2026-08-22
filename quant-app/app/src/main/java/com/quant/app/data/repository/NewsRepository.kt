package com.quant.app.data.repository

import com.quant.app.data.db.dao.NewsDao
import com.quant.app.data.db.entity.NewsEntity
import com.quant.app.data.network.DeepSeekApiClient
import com.quant.app.data.news.NewsFetcher
import com.quant.app.data.news.NewsItem
import com.quant.app.data.news.NewsPrompt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** 市场情绪聚合快照(供 AI 预测注入)。 */
data class SentimentSnapshot(
    val total: Int = 0,
    val bullishCount: Int = 0,
    val bearishCount: Int = 0,
    val neutralCount: Int = 0,
    val avgScore: Double = 0.0,          // bullish 为正、bearish 为负的均值(-1~1)
    val topKeywords: List<String> = emptyList(),
) {
    val label: String
        get() = when {
            total == 0 -> "无情报"
            avgScore >= 0.2 -> "偏多"
            avgScore <= -0.2 -> "偏空"
            else -> "中性"
        }
}

/**
 * 情报仓库:抓取 RSS → 去重落库 → DeepSeek 情绪分析回填 → 提供情绪聚合。
 */
class NewsRepository(
    private val fetcher: NewsFetcher,
    private val deepSeek: DeepSeekApiClient,
    private val newsDao: NewsDao,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val newsLock = Mutex()

    fun observeNews(limit: Int = 50): Flow<List<NewsEntity>> = newsDao.observeRecent(limit)

    suspend fun getRecent(limit: Int = 50): List<NewsEntity> = newsDao.getRecent(limit)

    /** 抓取 + 分析一次(前台服务定时调用 / UI 手动刷新)。 */
    suspend fun refresh() {
        newsLock.withLock {
            val items = fetcher.fetchAll()
            if (items.isEmpty()) return@withLock

            // 1. 落库(link 主键去重,已存在的 IGNORE)
            val now = System.currentTimeMillis()
            newsDao.insertAll(
                items.map {
                    NewsEntity(
                        link = it.link,
                        source = it.source,
                        title = it.title,
                        pubTime = it.pubTime,
                        content = it.description,
                        fetchedAt = now,
                    )
                }
            )

            // 2. 情绪分析(只处理未分析的新条目,每批 ≤10 条)
            analyzePending()

            // 3. 清理 7 天前的旧新闻
            newsDao.deleteBefore(now - 7L * 24 * 3600 * 1000)
        }
    }

    /** 手动刷新某源(忽略限频),供 UI 使用。 */
    suspend fun refreshSource(name: String, url: String) {
        val items = fetcher.fetchSource(name, url)
        if (items.isEmpty()) return
        newsLock.withLock {
            val now = System.currentTimeMillis()
            newsDao.insertAll(
                items.map {
                    NewsEntity(
                        link = it.link,
                        source = it.source,
                        title = it.title,
                        pubTime = it.pubTime,
                        content = it.description,
                        fetchedAt = now,
                    )
                }
            )
        }
        analyzePending()
    }

    private suspend fun analyzePending() {
        val pending = newsDao.getUnanalyzed(10)
        if (pending.isEmpty()) return
        runCatching {
            val input = pending.map {
                NewsItem(
                    source = it.source,
                    title = it.title,
                    link = it.link,
                    pubTime = it.pubTime,
                    description = it.content,
                )
            }
            val result = deepSeek.analyzeNews(
                NewsPrompt.buildSystemPrompt(),
                NewsPrompt.buildUserPrompt(input),
            )
            val byLink = result.items.associateBy { it.link }
            pending.forEach { news ->
                val r = byLink[news.link] ?: return@forEach
                newsDao.update(
                    news.copy(
                        sentiment = if (r.sentiment in SENTIMENTS) r.sentiment else "neutral",
                        score = r.score.coerceIn(0.0, 1.0),
                        category = r.category,
                    )
                )
            }
        }.onFailure { e ->
            android.util.Log.w(TAG, "新闻情绪分析失败: ${e.message}")
        }
    }

    /** 最近 30 条已分析新闻的情绪聚合(供预测 prompt 注入)。 */
    suspend fun sentimentSnapshot(limit: Int = 30): SentimentSnapshot {
        val recent = newsDao.getRecent(limit)
        val analyzed = recent.filter { it.sentiment != "neutral" || it.score > 0 }
        val bullish = analyzed.count { it.sentiment == "bullish" }
        val bearish = analyzed.count { it.sentiment == "bearish" }
        val neutral = analyzed.count { it.sentiment == "neutral" }
        val avg = analyzed
            .map { if (it.sentiment == "bullish") it.score else -it.score }
            .let { if (it.isEmpty()) 0.0 else it.average() }
        return SentimentSnapshot(
            total = analyzed.size,
            bullishCount = bullish,
            bearishCount = bearish,
            neutralCount = neutral,
            avgScore = avg,
            topKeywords = recent.take(5).map { it.title.take(12) },
        )
    }

    companion object {
        private const val TAG = "NewsRepository"
        private val SENTIMENTS = setOf("bullish", "bearish", "neutral")
    }
}
