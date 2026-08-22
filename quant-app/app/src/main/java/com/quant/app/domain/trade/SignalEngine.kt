package com.quant.app.domain.trade

import com.quant.app.data.config.ConfigStore
import com.quant.app.data.network.BinanceApiClient
import com.quant.app.data.network.dto.AccountDto
import com.quant.app.data.network.dto.AiSignalDto
import com.quant.app.domain.model.OpenSignal
import java.util.concurrent.ConcurrentHashMap

/** 交易决策结果。 */
sealed class TradeDecision {
    /** 不满足规则,跳过。 */
    data class Skip(val reason: String) : TradeDecision()

    /** 通过规则校验,可开仓。 */
    data class Open(val signal: OpenSignal) : TradeDecision()
}

/**
 * 信号引擎:AI 输出 → 规则过滤 → 交易决策。
 * 规则:
 * 1. neutral 或置信度低于阈值 → 跳过;
 * 2. 同币种冷却时间未到 → 跳过;
 * 3. 当日亏损熔断 → 跳过;
 * 4. 该币种已有持仓 → 跳过(MVP 不做加仓)。
 */
class SignalEngine(
    private val configStore: ConfigStore,
    private val riskManager: RiskManager,
    private val api: BinanceApiClient,
) {
    private val lastTradeAt = ConcurrentHashMap<String, Long>()

    private val config get() = configStore.load()

    suspend fun evaluate(symbol: String, signal: AiSignalDto): TradeDecision {
        // 1. 方向与置信度
        if (signal.direction == "neutral") {
            return TradeDecision.Skip("AI 判断观望")
        }
        if (signal.confidence < config.confidenceThreshold) {
            return TradeDecision.Skip(
                "置信度 ${signal.confidence} 低于阈值 ${config.confidenceThreshold}"
            )
        }

        // 2. 冷却时间
        val last = lastTradeAt[symbol]
        val now = System.currentTimeMillis()
        if (last != null && (now - last) < config.cooldownMinutes * 60_000L) {
            return TradeDecision.Skip("冷却中(${config.cooldownMinutes} 分钟)")
        }

        // 3. 熔断
        val account = runCatching { api.account() }.getOrNull()
        if (account != null) {
            val cb = riskManager.checkCircuitBreaker(account)
            if (cb.triggered) {
                return TradeDecision.Skip("当日亏损 ${"%.2f".format(cb.lossPct)}% 触发熔断")
            }
        }

        // 4. 已有持仓(MVP 不追加)
        if (account != null && hasOpenPosition(account, symbol)) {
            return TradeDecision.Skip("该币种已有持仓")
        }

        // 5. 生成开仓信号(止损止盈缺失时,用 ATR 兜底由执行层补算)
        return TradeDecision.Open(
            OpenSignal(
                symbol = symbol,
                direction = signal.direction,
                confidence = signal.confidence,
                entryPrice = signal.entry,
                stopLossPrice = signal.stopLoss,
                takeProfitPrice = signal.takeProfit,
                reason = signal.reasons.firstOrNull() ?: "",
            )
        )
    }

    /** 记录一次成功开仓(用于冷却)。 */
    fun markTraded(symbol: String) {
        lastTradeAt[symbol] = System.currentTimeMillis()
    }

    private fun hasOpenPosition(account: AccountDto, symbol: String): Boolean =
        account.positions.any { it.symbol == symbol && it.isOpen }
}
