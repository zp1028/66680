package com.quant.app.domain.trade

import com.quant.app.data.network.dto.AiSignalDto
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * 交易编排器:AI 信号 → SignalEngine 规则过滤 → TradeExecutor 执行。
 * 用 Mutex 保证同一时刻只有一个交易在途,避免重复开仓。
 */
class TradingOrchestrator(
    private val engine: SignalEngine,
    private val executor: TradeExecutor,
) {
    private val mutex = Mutex()

    /** 执行一次 AI 信号。mode: AUTO(自动)/ MANUAL(人工确认)。 */
    suspend fun onAiSignal(
        symbol: String,
        signal: AiSignalDto,
        mode: String,
        onDecision: (TradeDecision) -> Unit = {},
        onResult: (TradeResult) -> Unit = {},
    ) {
        mutex.withLock {
            val decision = engine.evaluate(symbol, signal)
            onDecision(decision)

            if (decision is TradeDecision.Open) {
                val result = executor.openPosition(decision.signal, mode)
                if (result is TradeResult.Success) {
                    engine.markTraded(symbol)
                }
                onResult(result)
            }
        }
    }
}
