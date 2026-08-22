package com.quant.app.data.news

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 解析后的单条新闻(未落库,纯数据)。 */
data class NewsItem(
    val source: String,
    val title: String,
    val link: String,
    val pubTime: Long,
    val description: String,
)

/**
 * RSS/Atom XML 解析器(系统 XmlPullParser,无第三方依赖)。
 * 解析 <item> 或 <entry> 中的 title/link/pubDate/description。
 */
object NewsParser {

    private val dateFormats = listOf(
        "EEE, dd MMM yyyy HH:mm:ss Z",   // RFC 822
        "EEE, dd MMM yyyy HH:mm:ss zzz",
        "yyyy-MM-dd'T'HH:mm:ssXXX",      // ISO 8601
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd HH:mm:ss",
    )

    fun parse(xml: String, source: String): List<NewsItem> {
        if (xml.isBlank()) return emptyList()
        return try {
            val factory = XmlPullParserFactory.newInstance()
            factory.isNamespaceAware = true
            val parser = factory.newPullParser()
            parser.setInput(StringReader(xml))

            val items = mutableListOf<NewsItem>()
            var inItem = false
            var title = ""
            var link = ""
            var pubDate = ""
            var description = ""
            var currentTag = ""

            var eventType = parser.eventType
            while (eventType != XmlPullParser.END_DOCUMENT) {
                when (eventType) {
                    XmlPullParser.START_TAG -> {
                        currentTag = parser.name.lowercase()
                        when (currentTag) {
                            "item", "entry" -> {
                                inItem = true
                                title = ""; link = ""; pubDate = ""; description = ""
                            }
                        }
                    }
                    XmlPullParser.TEXT -> {
                        if (inItem) {
                            when (currentTag) {
                                "title" -> title += parser.text
                                "link" -> {
                                    // Atom 的 link 在属性 href 中
                                    val href = parser.getAttributeValue(null, "href")
                                    if (!href.isNullOrBlank()) link = href else link += parser.text
                                }
                                "pubdate", "published", "updated" -> pubDate += parser.text
                                "description", "summary" -> description += parser.text
                            }
                        }
                    }
                    XmlPullParser.END_TAG -> {
                        if (parser.name.lowercase() in setOf("item", "entry")) {
                            inItem = false
                            val item = NewsItem(
                                source = source,
                                title = clean(title),
                                link = clean(link),
                                pubTime = parseDate(clean(pubDate)),
                                description = clean(description),
                            )
                            if (item.title.isNotBlank() && item.link.isNotBlank()) {
                                items.add(item)
                            }
                        }
                        currentTag = ""
                    }
                }
                eventType = parser.next()
            }
            items
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun clean(text: String): String =
        text.trim()
            .replace(Regex("<[^>]*>"), "")   // 去 HTML 标签
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .trim()

    private fun parseDate(raw: String): Long {
        if (raw.isBlank()) return System.currentTimeMillis()
        for (format in dateFormats) {
            val parsed = runCatching {
                SimpleDateFormat(format, Locale.ENGLISH).parse(raw)?.time
            }.getOrNull()
            if (parsed != null) return parsed
        }
        return System.currentTimeMillis()
    }
}
