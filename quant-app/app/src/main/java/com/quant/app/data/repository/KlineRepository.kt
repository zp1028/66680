package com.quant.app.data.repository

import com.quant.app.data.db.dao.KlineDao
import com.quant.app.data.db.entity.KlineEntity
import com.quant.app.data.network.BinanceApiClient
import com.quant.app.data.network.websocket.KlineStreamEvent
import com.quant.app.data.network.websocket.KlineStreamer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * K线仓库:REST 历史数据同步落库 + WebSocket 实时更新落库。
 * 每根 K线收盘时触发 [onKlineClosed],供 AI 分析(S4)调用。
 */
class KlineRepository(
    private val api: BinanceApiClient,
    private val klineDao: KlineDao,
    private val streamer: KlineStreamer,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    /** 某币种 K线收盘事件(已落库,可安全读取)。 */
    var onKlineClosed: ((KlineStreamEvent) -> Unit)? = null

    private var started = false

    /** 启动:拉历史 → 订阅实时流。重复调用幂等。 */
    fun start(symbols: List<String>, interval: String) {
        if (started) return
        started = true

        scope.launch {
            // 1. 历史同步(每个币种最近 500 根)
            runCatching { syncHistory(symbols, interval) }
                .onFailure { e -> android.util.Log.w(TAG, "历史K线同步失败", e) }

            // 2. 实时订阅
            streamer.connect(symbols, interval)
        }

        streamer.onKline = { event -> scope.launch { handleStreamEvent(event) } }
    }

    fun stop() {
        started = false
        streamer.disconnect()
    }

    fun observeRecent(symbol: String, interval: String, limit: Int): Flow<List<KlineEntity>> =
        klineDao.observeRecent(symbol, interval, limit)

    suspend fun getRecent(symbol: String, interval: String, limit: Int): List<KlineEntity> =
        klineDao.getRecentDesc(symbol, interval, limit)

    /** 从币安拉取历史 K线并落库。 */
    suspend fun syncHistory(symbols: List<String>, interval: String, limit: Int = 500) {
        withContext(Dispatchers.IO) {
            for (symbol in symbols) {
                runCatching {
                    val klines = api.klines(symbol, interval, limit)
                    klineDao.insertAll(
                        klines.map {
                            KlineEntity(
                                symbol = symbol,
                                interval = interval,
                                openTime = it.openTime,
                                open = it.open,
                                high = it.high,
                                low = it.low,
                                close = it.close,
                                volume = it.volume,
                                closeTime = it.closeTime,
                            )
                        }
                    )
                    // 只保留最近 ~2000 根,防止无限膨胀
                    val keepFrom = klines.lastOrNull()?.openTime?.minus(2000L * intervalToMillis(interval))
                    if (keepFrom != null) {
                        klineDao.deleteBefore(symbol, interval, keepFrom)
                    }
                }.onFailure { e ->
                    android.util.Log.w(TAG, "同步 $symbol 失败: ${e.message}")
                }
            }
        }
    }

    private suspend fun handleStreamEvent(event: KlineStreamEvent) {
        withContext(Dispatchers.IO) {
            runCatching {
                klineDao.insert(
                    KlineEntity(
                        symbol = event.symbol,
                        interval = event.interval,
                        openTime = event.openTime,
                        open = event.open,
                        high = event.high,
                        low = event.low,
                        close = event.close,
                        volume = event.volume,
                        closeTime = event.closeTime,
                    )
                )
            }.onFailure { e ->
                android.util.Log.w(TAG, "K线落库失败: ${e.message}")
            }
        }
        if (event.isClosed) {
            onKlineClosed?.invoke(event)
        }
    }

    private fun intervalToMillis(interval: String): Long = when {
        interval.endsWith("m") -> interval.dropLast(1).toLongOrNull()?.times(60_000L) ?: 60_000L
        interval.endsWith("h") -> interval.dropLast(1).toLongOrNull()?.times(3_600_000L) ?: 3_600_000L
        interval.endsWith("d") -> interval.dropLast(1).toLongOrNull()?.times(86_400_000L) ?: 86_400_000L
        else -> 60_000L
    }

    companion object {
        private const val TAG = "KlineRepository"
    }
}
