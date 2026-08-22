package com.quant.app.data.network

import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.max

/**
 * 币安权重制限频器。
 * 合约 REST 全局限额约 2400 权重/分钟;超过阈值则等待到下一分钟窗口。
 * 响应头 X-MBX-USED-WEIGHT-1M 可回传实际权重,这里采用保守本地估算。
 */
class BinanceRateLimiter(
    private val maxWeightPerMinute: Int = 2000,
) {
    private val mutex = Mutex()
    private var windowStartMs: Long = System.currentTimeMillis()
    private var usedWeight: Int = 0

    /** 记录一次请求权重并等待,直到权重配额允许。 */
    suspend fun acquire(weight: Int = 1) {
        mutex.withLock {
            while (true) {
                val now = System.currentTimeMillis()
                if (now - windowStartMs >= 60_000L) {
                    // 新窗口
                    windowStartMs = now
                    usedWeight = 0
                }
                if (usedWeight + weight <= maxWeightPerMinute) {
                    usedWeight += weight
                    return
                }
                // 等待到窗口结束
                val waitMs = max(1L, 60_000L - (now - windowStartMs))
                mutex.unlock()
                try {
                    delay(waitMs)
                } finally {
                    mutex.lock()
                }
            }
        }
    }

    /** 服务器返回的实际权重覆盖本地估算(可选)。 */
    suspend fun reportUsed(weight: Int) {
        mutex.withLock {
            usedWeight = max(usedWeight, weight)
        }
    }
}
