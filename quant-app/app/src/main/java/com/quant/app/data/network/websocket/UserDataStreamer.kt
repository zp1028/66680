package com.quant.app.data.network.websocket

import com.quant.app.data.db.dao.TradeDao
import com.quant.app.data.config.ConfigStore
import com.quant.app.data.network.BinanceApiClient
import com.quant.app.data.network.dto.UserDataEventWrapper
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
 * 币安用户数据流 WebSocket(listenKey)。
 * 监听订单成交事件,止损单触发后自动更新交易记录并回调通知。
 * 内置 30 分钟 listenKey 保活。
 */
class UserDataStreamer(
    private val api: BinanceApiClient,
    private val tradeDao: TradeDao,
    private val modeProvider: () -> TradingMode,
    private val okHttp: OkHttpClient = defaultOkHttp(),
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val baseUrl: String
        get() = if (modeProvider() == TradingMode.TESTNET) {
            "wss://stream.binancefuture.com"
        } else {
            "wss://fstream.binance.com"
        }

    private var listenKey: String? = null
    private var webSocket: WebSocket? = null
    private var keepAliveJob: Job? = null

    /** 止损触发回调(symbol, orderId)。 */
    var onStopLossTriggered: ((String, Long) -> Unit)? = null
    var onConnectionChanged: ((Boolean) -> Unit)? = null

    fun start() {
        scope.launch {
            val key = runCatching { api.createListenKey() }.getOrNull()
            if (key == null) {
                android.util.Log.w(TAG, "获取 listenKey 失败")
                return@launch
            }
            listenKey = key
            openSocket(key)
            startKeepAlive()
        }
    }

    fun stop() {
        keepAliveJob?.cancel()
        webSocket?.close(NORMAL_CLOSE, "stop")
        webSocket = null
        listenKey = null
        onConnectionChanged?.invoke(false)
    }

    fun release() {
        stop()
        scope.cancel()
    }

    private fun openSocket(key: String) {
        val url = "$baseUrl/ws/$key"
        val request = Request.Builder().url(url).build()
        webSocket = okHttp.newWebSocket(request, listener)
    }

    private fun startKeepAlive() {
        keepAliveJob?.cancel()
        keepAliveJob = scope.launch {
            while (isActive) {
                delay(KEEP_ALIVE_INTERVAL_MS)
                runCatching { api.extendListenKey() }
            }
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            onConnectionChanged?.invoke(true)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val event = runCatching {
                json.decodeFromString(UserDataEventWrapper.serializer(), text)
            }.getOrNull()
            if (event?.eventType == "ORDER_TRADE_UPDATE") {
                handleOrderUpdate(event.order)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            onConnectionChanged?.invoke(false)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            onConnectionChanged?.invoke(false)
        }
    }

    private fun handleOrderUpdate(order: UserDataEventWrapper.OrderUpdate?) {
        if (order == null || order.status != "FILLED") return
        scope.launch {
            val trade = tradeDao.getByStopLossOrderId(order.orderId) ?: return@launch
            val pnl = order.realizedPnl.toDoubleOrNull()
            val closedPrice = order.avgPrice.toDoubleOrNull()
            tradeDao.markClosed(
                orderId = trade.orderId,
                status = "STOPPED",
                pnl = pnl,
                closedAt = System.currentTimeMillis(),
                closedPrice = closedPrice,
            )
            android.util.Log.i(TAG, "止损触发: ${trade.symbol} orderId=${order.orderId} PnL=$pnl")
            onStopLossTriggered?.invoke(trade.symbol, trade.orderId)
        }
    }

    companion object {
        private const val TAG = "UserDataStreamer"
        private const val NORMAL_CLOSE = 1000
        private const val KEEP_ALIVE_INTERVAL_MS = 30 * 60 * 1000L

        private fun defaultOkHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
}
