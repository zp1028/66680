package com.quant.app.data.network

import com.quant.app.data.config.ConfigStore
import com.quant.app.data.network.dto.AccountDto
import com.quant.app.data.network.dto.BinanceErrorDto
import com.quant.app.data.network.dto.ExchangeInfoDto
import com.quant.app.data.network.dto.KlineDto
import com.quant.app.data.network.dto.OrderResponseDto
import com.quant.app.data.network.dto.PositionDto
import com.quant.app.data.network.dto.SymbolTickerDto
import com.quant.app.data.network.dto.UserTradeDto
import com.quant.app.domain.model.OrderRequest
import com.quant.app.domain.model.TradingMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.long
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** 币安 API 异常。 */
class BinanceApiException(val code: Int, override val message: String) : IOException("Binance error $code: $message")

/**
 * 币安 USDT-M 合约 REST 客户端。
 * - 测试网 baseUrl: https://testnet.binancefuture.com
 * - 实盘 baseUrl:   https://fapi.binance.com
 * 签名、时间偏移、限频均在此封装。
 */
class BinanceApiClient(
    private val configStore: ConfigStore,
    private val rateLimiter: BinanceRateLimiter,
    private val okHttp: OkHttpClient = defaultOkHttp(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val timeMutex = Mutex()
    private var timeOffsetMs: Long = 0L
    private var timeSynced = false

    private val baseUrl: String
        get() = if (configStore.load().mode == TradingMode.TESTNET) {
            "https://testnet.binancefuture.com"
        } else {
            "https://fapi.binance.com"
        }

    // ---------- 公开行情(无需签名) ----------

    suspend fun klines(symbol: String, interval: String, limit: Int): List<KlineDto> {
        rateLimiter.acquire(1)
        val url = buildUrl("/fapi/v1/klines", mapOf(
            "symbol" to symbol,
            "interval" to interval,
            "limit" to limit.toString(),
        ))
        val body = executeRaw(Request.Builder().url(url).get().build())
        return parseKlines(json.parseToJsonElement(body) as JsonArray)
    }

    suspend fun exchangeInfo(): ExchangeInfoDto {
        rateLimiter.acquire(1)
        val url = buildUrl("/fapi/v1/exchangeInfo", emptyMap())
        val body = executeRaw(Request.Builder().url(url).get().build())
        return json.decodeFromString(ExchangeInfoDto.serializer(), body)
    }

    /** 按 24h 成交额降序返回热门 USDT 本位永续合约。 */
    suspend fun hotSymbols(limit: Int = 10): List<String> {
        rateLimiter.acquire(1)
        val url = buildUrl("/fapi/v1/ticker/24hr", emptyMap())
        val body = executeRaw(Request.Builder().url(url).get().build())
        val tickers = json.decodeFromString<List<SymbolTickerDto>>(body)
        return tickers
            .filter { it.symbol.endsWith("USDT") }
            .sortedByDescending { it.quoteVolume.toDoubleOrNull() ?: 0.0 }
            .take(limit)
            .map { it.symbol }
    }

    suspend fun serverTime(): Long {
        val url = buildUrl("/fapi/v1/time", emptyMap())
        val body = executeRaw(Request.Builder().url(url).get().build())
        return json.parseToJsonElement(body).jsonObject["serverTime"]!!.jsonPrimitive.long
    }

    // ---------- 账户与交易(需签名) ----------

    suspend fun account(): AccountDto {
        rateLimiter.acquire(2)
        val url = signedUrl("/fapi/v2/account", emptyMap())
        val body = executeRaw(Request.Builder().url(url).get().build())
        return json.decodeFromString(AccountDto.serializer(), body)
    }

    suspend fun positionRisk(): List<PositionDto> {
        rateLimiter.acquire(2)
        val url = signedUrl("/fapi/v2/positionRisk", emptyMap())
        val body = executeRaw(Request.Builder().url(url).get().build())
        return json.decodeFromString<List<PositionDto>>(body)
    }

    suspend fun placeOrder(request: OrderRequest): OrderResponseDto {
        rateLimiter.acquire(1)
        val params = mutableMapOf(
            "symbol" to request.symbol,
            "side" to request.side,
            "positionSide" to request.positionSide,
            "type" to request.type,
            "quantity" to request.quantity,
        )
        request.price?.let { params["price"] = it }
        request.stopPrice?.let { params["stopPrice"] = it }
        request.timeInForce?.let { params["timeInForce"] = it }
        params["reduceOnly"] = request.reduceOnly.toString()
        request.newClientOrderId?.let { params["newClientOrderId"] = it }

        val url = signedUrl("/fapi/v1/order", params)
        val body = executeRaw(Request.Builder().url(url).post("".toRequestBody(FORM)).build())
        return json.decodeFromString(OrderResponseDto.serializer(), body)
    }

    /** 追加止损单(STOP_MARKET,reduceOnly),开仓后调用形成"币安侧保护"。 */
    suspend fun placeStopLoss(symbol: String, positionSide: String, quantity: String, stopPrice: String): OrderResponseDto {
        return placeOrder(
            OrderRequest(
                symbol = symbol,
                side = if (positionSide == "LONG") "SELL" else "BUY",
                positionSide = positionSide,
                type = "STOP_MARKET",
                quantity = quantity,
                stopPrice = stopPrice,
                reduceOnly = true,
            )
        )
    }

    suspend fun cancelOrder(symbol: String, orderId: Long) {
        rateLimiter.acquire(1)
        val params = mapOf("symbol" to symbol, "orderId" to orderId.toString())
        val body = signedBody("/fapi/v1/order", params)
        executeRaw(Request.Builder().url(baseUrl + "/fapi/v1/order").delete(body).build())
    }

    suspend fun getOrder(symbol: String, orderId: Long): OrderResponseDto {
        rateLimiter.acquire(1)
        val params = mapOf("symbol" to symbol, "orderId" to orderId.toString())
        val url = signedUrl("/fapi/v1/order", params)
        val body = executeRaw(Request.Builder().url(url).get().build())
        return json.decodeFromString(OrderResponseDto.serializer(), body)
    }

    /** 设置合约杠杆(1~125),供 UI 随时调整。 */
    suspend fun setLeverage(symbol: String, leverage: Int) {
        rateLimiter.acquire(1)
        val params = mapOf("symbol" to symbol, "leverage" to leverage.toString())
        val url = signedUrl("/fapi/v1/leverage", params)
        executeRaw(Request.Builder().url(url).post("".toRequestBody(FORM)).build())
    }

    /** 查询成交明细(已实现盈亏来源)。 */
    suspend fun userTrades(symbol: String, limit: Int = 50): List<UserTradeDto> {
        rateLimiter.acquire(5)
        val params = mapOf("symbol" to symbol, "limit" to limit.toString())
        val url = signedUrl("/fapi/v1/userTrades", params)
        val body = executeRaw(Request.Builder().url(url).get().build())
        return json.decodeFromString(body)
    }

    // ---------- 用户数据流(listenKey) ----------

    suspend fun createListenKey(): String {
        rateLimiter.acquire(1)
        val url = signedUrl("/fapi/v1/listenKey", emptyMap())
        val body = executeRaw(Request.Builder().url(url).post("".toRequestBody(FORM)).build())
        return json.parseToJsonElement(body).jsonObject["listenKey"]!!.jsonPrimitive.content
    }

    /** 每 30 分钟调用一次保活。 */
    suspend fun extendListenKey() {
        rateLimiter.acquire(1)
        val url = signedUrl("/fapi/v1/listenKey", emptyMap())
        executeRaw(Request.Builder().url(url).put("".toRequestBody(FORM)).build())
    }

    // ---------- 内部实现 ----------

    private fun buildUrl(path: String, params: Map<String, String>): String {
        val builder = (baseUrl + path).toHttpUrl().newBuilder()
        params.forEach { (k, v) -> builder.addQueryParameter(k, v) }
        return builder.build().toString()
    }

    private suspend fun signedUrl(path: String, params: Map<String, String>): String {
        val now = currentBinanceTime()
        val full = params + mapOf(
            "timestamp" to now.toString(),
            "recvWindow" to RECV_WINDOW.toString(),
        )
        val queryString = BinanceSigner.buildQueryString(full)
        val signature = BinanceSigner.sign(queryString, configStore.load().activeSecretKey)
        return buildUrl(path, full + mapOf("signature" to signature))
    }

    private suspend fun signedBody(path: String, params: Map<String, String>): okhttp3.RequestBody {
        val now = currentBinanceTime()
        val full = params + mapOf(
            "timestamp" to now.toString(),
            "recvWindow" to RECV_WINDOW.toString(),
        )
        val queryString = BinanceSigner.buildQueryString(full)
        val signature = BinanceSigner.sign(queryString, configStore.load().activeSecretKey)
        return "$queryString&signature=$signature".toRequestBody(FORM)
    }

    private suspend fun currentBinanceTime(): Long {
        // 首次请求前同步一次服务器时间偏移,避免每个请求都多一次往返
        if (!timeSynced) {
            timeMutex.withLock {
                if (!timeSynced) {
                    val server = serverTime()
                    timeOffsetMs = server - System.currentTimeMillis()
                    timeSynced = true
                }
            }
        }
        return System.currentTimeMillis() + timeOffsetMs
    }

    private suspend fun executeRaw(request: Request): String = withContext(Dispatchers.IO) {
        okHttp.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                val error = runCatching {
                    json.decodeFromString(BinanceErrorDto.serializer(), body)
                }.getOrNull()
                throw BinanceApiException(
                    code = error?.code ?: response.code,
                    message = error?.msg ?: body.ifBlank { "HTTP ${response.code}" },
                )
            }
            // 读取限频权重,供限频器校准(可选)
            response.header("X-MBX-USED-WEIGHT-1M")?.toIntOrNull()?.let {
                rateLimiter.reportUsed(it)
            }
            body
        }
    }

    private fun parseKlines(array: JsonArray): List<KlineDto> = array.map { row ->
        val items = row as JsonArray
        KlineDto(
            openTime = items[0].jsonPrimitive.long,
            open = items[1].jsonPrimitive.double,
            high = items[2].jsonPrimitive.double,
            low = items[3].jsonPrimitive.double,
            close = items[4].jsonPrimitive.double,
            volume = items[5].jsonPrimitive.double,
            closeTime = items[6].jsonPrimitive.long,
        )
    }

    companion object {
        private const val RECV_WINDOW = 10_000L
        private val FORM = "application/x-www-form-urlencoded".toMediaType()

        private fun defaultOkHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
