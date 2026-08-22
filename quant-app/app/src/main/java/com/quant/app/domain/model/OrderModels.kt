package com.quant.app.domain.model

/**
 * 下单请求参数(币安 USDT-M 合约 POST /fapi/v1/order)。
 * 开仓时如需随单止损,传 [stopLossPrice],客户端会追加 STOP_MARKET 止损单。
 */
data class OrderRequest(
    val symbol: String,
    val side: String,          // BUY / SELL
    val positionSide: String,  // LONG / SHORT / BOTH(单向持仓用 BOTH)
    val type: String,          // MARKET / LIMIT / STOP_MARKET / TAKE_PROFIT_MARKET
    val quantity: String,
    val price: String? = null,        // LIMIT 必填
    val stopPrice: String? = null,    // STOP_MARKET / TAKE_PROFIT_MARKET 必填
    val timeInForce: String? = null,  // GTC / IOC / FOK
    val reduceOnly: Boolean = false,
    val newClientOrderId: String? = null,
)

/** 开仓指令(由 SignalEngine 产生,RiskManager 校验后转 OrderRequest)。 */
data class OpenSignal(
    val symbol: String,
    val direction: String,      // long / short
    val confidence: Double,
    val entryPrice: Double?,
    val stopLossPrice: Double?,
    val takeProfitPrice: Double?,
    val reason: String,
)
