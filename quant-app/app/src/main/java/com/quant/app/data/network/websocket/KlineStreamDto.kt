package com.quant.app.data.network.websocket

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 合并流外层:{"stream":"btcusdt@kline_15m","data":{...}} */
@Serializable
data class KlineStreamWrapperDto(
    @SerialName("stream") val stream: String,
    @SerialName("data") val data: KlineStreamDataDto,
)

@Serializable
data class KlineStreamDataDto(
    @SerialName("e") val eventType: String,
    @SerialName("s") val symbol: String,
    @SerialName("k") val kline: KlinePayloadDto,
)

@Serializable
data class KlinePayloadDto(
    @SerialName("t") val openTime: Long,
    @SerialName("T") val closeTime: Long,
    @SerialName("s") val symbol: String,
    @SerialName("i") val interval: String,
    @SerialName("o") val open: String,
    @SerialName("h") val high: String,
    @SerialName("l") val low: String,
    @SerialName("c") val close: String,
    @SerialName("v") val volume: String,
    @SerialName("x") val isClosed: Boolean,
)

/** 解析后的 K线流事件(供仓库落库与收盘触发)。 */
data class KlineStreamEvent(
    val symbol: String,
    val interval: String,
    val openTime: Long,
    val closeTime: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val isClosed: Boolean,
)
