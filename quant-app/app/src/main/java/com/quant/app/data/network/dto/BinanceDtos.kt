package com.quant.app.data.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** K线数据(币安返回 JSON 数组格式,手动解析为对象)。 */
data class KlineDto(
    val openTime: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val closeTime: Long,
)

/** 账户资产(/fapi/v2/account 的 assets 元素)。 */
@Serializable
data class AssetDto(
    @SerialName("asset") val asset: String,
    @SerialName("walletBalance") val walletBalance: String,
    @SerialName("unrealizedProfit") val unrealizedProfit: String,
    @SerialName("marginBalance") val marginBalance: String,
)

/** 持仓(/fapi/v2/account.positions 与 /fapi/v2/positionRisk 元素)。 */
@Serializable
data class PositionDto(
    @SerialName("symbol") val symbol: String,
    @SerialName("positionSide") val positionSide: String,
    @SerialName("positionAmt") val positionAmt: String,
    @SerialName("entryPrice") val entryPrice: String,
    @SerialName("markPrice") val markPrice: String,
    @SerialName("unRealizedProfit") val unRealizedProfit: String,
    @SerialName("liquidationPrice") val liquidationPrice: String,
    @SerialName("leverage") val leverage: String,
) {
    val isOpen: Boolean get() = positionAmt.toDoubleOrNull()?.let { it != 0.0 } ?: false
}

/** 账户(/fapi/v2/account)。 */
@Serializable
data class AccountDto(
    @SerialName("totalWalletBalance") val totalWalletBalance: String,
    @SerialName("totalUnrealizedProfit") val totalUnrealizedProfit: String,
    @SerialName("availableBalance") val availableBalance: String,
    @SerialName("assets") val assets: List<AssetDto> = emptyList(),
    @SerialName("positions") val positions: List<PositionDto> = emptyList(),
)

/** 订单(/fapi/v1/order 响应)。 */
@Serializable
data class OrderResponseDto(
    @SerialName("orderId") val orderId: Long,
    @SerialName("symbol") val symbol: String,
    @SerialName("side") val side: String,
    @SerialName("positionSide") val positionSide: String,
    @SerialName("type") val type: String,
    @SerialName("status") val status: String,
    @SerialName("price") val price: String,
    @SerialName("origQty") val origQty: String,
    @SerialName("executedQty") val executedQty: String,
    @SerialName("avgPrice") val avgPrice: String,
    @SerialName("stopPrice") val stopPrice: String? = null,
    @SerialName("reduceOnly") val reduceOnly: Boolean = false,
)

/** 币安错误响应。 */
@Serializable
data class BinanceErrorDto(
    @SerialName("code") val code: Int,
    @SerialName("msg") val msg: String,
)

/** 成交明细(/fapi/v1/userTrades 元素)。 */
@Serializable
data class UserTradeDto(
    @SerialName("symbol") val symbol: String,
    @SerialName("id") val id: Long,
    @SerialName("orderId") val orderId: Long,
    @SerialName("side") val side: String,
    @SerialName("price") val price: String,
    @SerialName("qty") val qty: String,
    @SerialName("realizedPnl") val realizedPnl: String,
    @SerialName("commission") val commission: String,
    @SerialName("time") val time: Long,
)

/** 用户数据流 WebSocket 事件包装。 */
@Serializable
data class UserDataEventWrapper(
    @SerialName("e") val eventType: String = "",
    @SerialName("o") val order: OrderUpdate? = null,
) {
    @Serializable
    data class OrderUpdate(
        @SerialName("s") val symbol: String = "",
        @SerialName("i") val orderId: Long = 0,
        @SerialName("X") val status: String = "",        // FILLED / PARTIALLY_FILLED / CANCELED
        @SerialName("ap") val avgPrice: String = "",
        @SerialName("q") val qty: String = "",
        @SerialName("rp") val realizedPnl: String = "",
    )
}

/** 交易对信息(/fapi/v1/exchangeInfo.symbols 元素,仅取所需字段)。 */
@Serializable
data class SymbolInfoDto(
    @SerialName("symbol") val symbol: String,
    @SerialName("status") val status: String,
    @SerialName("contractType") val contractType: String,
    @SerialName("quoteAsset") val quoteAsset: String,
    @SerialName("baseAsset") val baseAsset: String,
    @SerialName("pricePrecision") val pricePrecision: Int,
    @SerialName("quantityPrecision") val quantityPrecision: Int,
    @SerialName("onboardDate") val onboardDate: Long,
)

@Serializable
data class ExchangeInfoDto(
    @SerialName("symbols") val symbols: List<SymbolInfoDto> = emptyList(),
)

/** 24h 行情(/fapi/v1/ticker/24hr 元素,用于热门币种筛选)。 */
@Serializable
data class SymbolTickerDto(
    @SerialName("symbol") val symbol: String,
    @SerialName("quoteVolume") val quoteVolume: String,
    @SerialName("lastPrice") val lastPrice: String,
    @SerialName("priceChangePercent") val priceChangePercent: String,
)
