package com.quant.app.data.news

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * 多源新闻抓取器(RSS 聚合,免 API Key)。
 * - Google News RSS(英文 + 中文关键词,免费)
 * - CoinDesk / Cointelegraph(英文币圈媒体)
 * 抓取失败自动降级(记录源健康状态),不影响主链路。
 */
class NewsFetcher(
    private val okHttp: OkHttpClient = defaultOkHttp(),
) {

    /** 各源抓取时间(毫秒),用于限频。 */
    private val lastFetchAt = HashMap<String, Long>()

    /** 抓取全部源,返回聚合列表(未去重)。限频:每源 30 分钟。 */
    suspend fun fetchAll(minIntervalMs: Long = 30 * 60 * 1000L): List<NewsItem> = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val result = mutableListOf<NewsItem>()
        for (source in SOURCES) {
            val last = lastFetchAt[source.name] ?: 0L
            if (now - last < minIntervalMs) continue   // 限频跳过
            runCatching {
                val xml = get(source.url)
                result += NewsParser.parse(xml, source.name)
                lastFetchAt[source.name] = now
            }.onFailure { e ->
                android.util.Log.w(TAG, "抓取 ${source.name} 失败: ${e.message}")
            }
        }
        result
    }

    /** 主动抓取指定源(手动刷新时忽略限频)。 */
    suspend fun fetchSource(name: String, url: String): List<NewsItem> = withContext(Dispatchers.IO) {
        runCatching {
            val xml = get(url)
            lastFetchAt[name] = System.currentTimeMillis()
            NewsParser.parse(xml, name)
        }.getOrElse { emptyList() }
    }

    private fun get(url: String): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", UA)
            .header("Accept", "application/rss+xml, application/xml, text/xml, */*")
            .build()
        okHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}")
            return response.body?.string() ?: ""
        }
    }

    companion object {
        private const val TAG = "NewsFetcher"
        private const val UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"

        data class Source(val name: String, val url: String)

        /** 源列表:英文为主,中文为辅。 */
        val SOURCES = listOf(
            Source(
                "GoogleNews-EN",
                "https://news.google.com/rss/search?q=bitcoin+OR+crypto+OR+ethereum&hl=en-US&gl=US&ceid=US:en",
            ),
            Source(
                "GoogleNews-CN",
                "https://news.google.com/rss/search?q=%E6%AF%94%E7%89%B9%E5%B8%81+OR+%E5%8A%A0%E5%AF%86%E8%B4%A7%E5%B8%81&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
            ),
            Source("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
            Source("Cointelegraph", "https://cointelegraph.com/rss"),
        )

        private fun defaultOkHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }
}
