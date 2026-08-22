package com.quant.app.data.network.websocket

import com.quant.app.domain.model.TradingMode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * 币安 USDT-M K线 WebSocket 客户端(多路合并流,单连接订阅多币种)。
 * - 测试网: wss://stream.binancefuture.com
 * - 实盘:   wss://fstream.binance.com
 * 内置断线自动重连(指数退避)与 10s 应用层心跳。
 */
class KlineStreamer(
    private val modeProvider: () -> TradingMode,
    private val okHttp: OkHttpClient = defaultOkHttp(),
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val json = Json { ignoreUnknownKeys = true }

    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    private var currentStreams: List<String> = emptyList()
    private var retryDelayMs = INITIAL_RETRY_MS
    private var manualClose = false

    /** 收到实时 K线(未收盘/已收盘都会回调,x=true 表示收盘)。 */
    var onKline: ((KlineStreamEvent) -> Unit)? = null
    /** 连接状态变化回调。 */
    var onConnectionChanged: ((Boolean) -> Unit)? = null

    private val baseUrl: String
        get() = if (modeProvider() == TradingMode.TESTNET) {
            "wss://stream.binancefuture.com"
        } else {
            "wss://fstream.binance.com"
        }

    @Synchronized
    fun connect(symbols: List<String>, interval: String) {
        currentStreams = symbols.map { "${it.lowercase()}@kline_$interval" }
        manualClose = false
        openSocket()
    }

    @Synchronized
    fun disconnect() {
        manualClose = true
        reconnectJob?.cancel()
        pingJob?.cancel()
        webSocket?.close(NORMAL_CLOSE, "disconnect")
        webSocket = null
        onConnectionChanged?.invoke(false)
    }

    @Synchronized
    private fun openSocket() {
        if (currentStreams.isEmpty()) return
        val streams = currentStreams.joinToString("/")
        val url = "$baseUrl/stream?streams=$streams"
        val request = Request.Builder().url(url).build()
        webSocket = okHttp.newWebSocket(request, listener)
        startPing()
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            retryDelayMs = INITIAL_RETRY_MS
            onConnectionChanged?.invoke(true)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (text == PONG_MESSAGE) return
            val event = try {
                parseMessage(text)
            } catch (e: Exception) {
                null
            }
            event?.let { onKline?.invoke(it) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            onConnectionChanged?.invoke(false)
            scheduleReconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            onConnectionChanged?.invoke(false)
            scheduleReconnect()
        }
    }

    private fun parseMessage(text: String): KlineStreamEvent {
        val wrapper = json.decodeFromString(KlineStreamWrapperDto.serializer(), text)
        val k = wrapper.data.kline
        return KlineStreamEvent(
            symbol = k.symbol,
            interval = k.interval,
            openTime = k.openTime,
            closeTime = k.closeTime,
            open = k.open.toDoubleOrNull() ?: 0.0,
            high = k.high.toDoubleOrNull() ?: 0.0,
            low = k.low.toDoubleOrNull() ?: 0.0,
            close = k.close.toDoubleOrNull() ?: 0.0,
            volume = k.volume.toDoubleOrNull() ?: 0.0,
            isClosed = k.isClosed,
        )
    }

    private fun scheduleReconnect() {
        if (manualClose) return
        if (reconnectJob?.isActive == true) return
        reconnectJob = scope.launch {
            delay(retryDelayMs)
            retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_MS)
            synchronized(this@KlineStreamer) {
                if (!manualClose && scope.isActive) openSocket()
            }
        }
    }

    /** 应用层心跳:每 10s 发一次 PING 文本帧。 */
    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (isActive) {
                delay(10_000L)
                runCatching { webSocket?.send(PING_MESSAGE) }
            }
        }
    }

    fun release() {
        disconnect()
        scope.cancel()
    }

    companion object {
        private const val NORMAL_CLOSE = 1000
        private const val PING_MESSAGE = "ping"
        private const val PONG_MESSAGE = "pong"
        private const val INITIAL_RETRY_MS = 2_000L
        private const val MAX_RETRY_MS = 60_000L

        private fun defaultOkHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // WebSocket 长连接不设读超时
            .pingInterval(30, TimeUnit.SECONDS)     // OkHttp 自带 WebSocket ping
            .build()
    }
}
