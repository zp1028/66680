package com.quant.app.domain.model

/**
 * 运行时配置模型。所有字段均有默认值,未配置时程序进入"未初始化"引导态。
 * 安全策略:币安 Key / DeepSeek Key 仅存于加密存储,不落普通数据库。
 * 双环境隔离:测试网与实盘的 API Key 分开存储,避免错单。
 */
data class AppConfig(
    /** 测试网(模拟)API Key */
    val testnetApiKey: String = "",
    val testnetSecretKey: String = "",
    /** 实盘 API Key */
    val liveApiKey: String = "",
    val liveSecretKey: String = "",
    val deepseekApiKey: String = "",
    /** 交易环境:TESTNET(模拟)/ LIVE(实盘) */
    val mode: TradingMode = TradingMode.TESTNET,
    /** 自动下单开关:true=AI 信号直接自动下单;false=仅出建议,人工确认(推荐) */
    val autoTrade: Boolean = false,
    /** 自动下单置信度阈值,默认 0.7 */
    val confidenceThreshold: Double = 0.7,
    /** 杠杆倍数(读取自币安账户,允许随时调整) */
    val leverage: Int = 3,
    /** 单笔开仓保证金上限(USDT) */
    val maxPositionUsd: Double = 100.0,
    /** 当日累计亏损熔断比例(%) */
    val maxDailyLossPct: Double = 5.0,
    /** 同币种两次交易最小间隔(分钟) */
    val cooldownMinutes: Int = 30,
    /** K线周期,默认 15m */
    val interval: String = "15m",
    /** 监控的合约列表 */
    val symbols: List<String> = listOf("BTCUSDT", "ETHUSDT", "SOLUSDT"),
) {
    /** 当前环境生效的币安 Key。 */
    val activeApiKey: String
        get() = if (mode == TradingMode.LIVE) liveApiKey else testnetApiKey

    val activeSecretKey: String
        get() = if (mode == TradingMode.LIVE) liveSecretKey else testnetSecretKey

    val isConfigured: Boolean
        get() = activeApiKey.isNotBlank() &&
            activeSecretKey.isNotBlank() &&
            deepseekApiKey.isNotBlank()
}

enum class TradingMode(val label: String) {
    TESTNET("测试网"),
    LIVE("实盘"),
}
