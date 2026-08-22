package com.quant.app.data.config

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.quant.app.domain.model.AppConfig
import com.quant.app.domain.model.TradingMode

/**
 * 基于 EncryptedSharedPreferences 的加密配置存储。
 * 币安 API Key/Secret、DeepSeek Key 以 AES256-GCM 加密落盘;
 * 明文策略参数(阈值/杠杆/周期等)存同一文件,简化读写。
 */
class ConfigStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun load(): AppConfig = AppConfig(
        testnetApiKey = prefs.getString(KEY_TESTNET_API, "") ?: "",
        testnetSecretKey = prefs.getString(KEY_TESTNET_SECRET, "") ?: "",
        liveApiKey = prefs.getString(KEY_LIVE_API, "") ?: "",
        liveSecretKey = prefs.getString(KEY_LIVE_SECRET, "") ?: "",
        deepseekApiKey = prefs.getString(KEY_DEEPSEEK_API, "") ?: "",
        mode = TradingMode.valueOf(prefs.getString(KEY_MODE, TradingMode.TESTNET.name) ?: TradingMode.TESTNET.name),
        autoTrade = prefs.getBoolean(KEY_AUTO_TRADE, false),
        confidenceThreshold = prefs.getFloat(KEY_CONFIDENCE_THRESHOLD, 0.7f).toDouble(),
        leverage = prefs.getInt(KEY_LEVERAGE, 3),
        maxPositionUsd = prefs.getFloat(KEY_MAX_POSITION_USD, 100f).toDouble(),
        maxDailyLossPct = prefs.getFloat(KEY_MAX_DAILY_LOSS_PCT, 5f).toDouble(),
        cooldownMinutes = prefs.getInt(KEY_COOLDOWN_MINUTES, 30),
        interval = prefs.getString(KEY_INTERVAL, "15m") ?: "15m",
        symbols = prefs.getString(KEY_SYMBOLS, "BTCUSDT,ETHUSDT,SOLUSDT")
            ?.split(",")
            ?.filter { it.isNotBlank() }
            ?.takeIf { it.isNotEmpty() }
            ?: listOf("BTCUSDT", "ETHUSDT", "SOLUSDT"),
    )

    fun save(config: AppConfig) {
        prefs.edit()
            .putString(KEY_TESTNET_API, config.testnetApiKey)
            .putString(KEY_TESTNET_SECRET, config.testnetSecretKey)
            .putString(KEY_LIVE_API, config.liveApiKey)
            .putString(KEY_LIVE_SECRET, config.liveSecretKey)
            .putString(KEY_DEEPSEEK_API, config.deepseekApiKey)
            .putString(KEY_MODE, config.mode.name)
            .putBoolean(KEY_AUTO_TRADE, config.autoTrade)
            .putFloat(KEY_CONFIDENCE_THRESHOLD, config.confidenceThreshold.toFloat())
            .putInt(KEY_LEVERAGE, config.leverage)
            .putFloat(KEY_MAX_POSITION_USD, config.maxPositionUsd.toFloat())
            .putFloat(KEY_MAX_DAILY_LOSS_PCT, config.maxDailyLossPct.toFloat())
            .putInt(KEY_COOLDOWN_MINUTES, config.cooldownMinutes)
            .putString(KEY_INTERVAL, config.interval)
            .putString(KEY_SYMBOLS, config.symbols.joinToString(","))
            .apply()
    }

    fun clearSecrets() {
        prefs.edit()
            .remove(KEY_TESTNET_API)
            .remove(KEY_TESTNET_SECRET)
            .remove(KEY_LIVE_API)
            .remove(KEY_LIVE_SECRET)
            .remove(KEY_DEEPSEEK_API)
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "quant_secure_config"

        private const val KEY_TESTNET_API = "testnet_api_key"
        private const val KEY_TESTNET_SECRET = "testnet_secret_key"
        private const val KEY_LIVE_API = "live_api_key"
        private const val KEY_LIVE_SECRET = "live_secret_key"
        private const val KEY_DEEPSEEK_API = "deepseek_api_key"
        private const val KEY_MODE = "mode"
        private const val KEY_AUTO_TRADE = "auto_trade"
        private const val KEY_CONFIDENCE_THRESHOLD = "confidence_threshold"
        private const val KEY_LEVERAGE = "leverage"
        private const val KEY_MAX_POSITION_USD = "max_position_usd"
        private const val KEY_MAX_DAILY_LOSS_PCT = "max_daily_loss_pct"
        private const val KEY_COOLDOWN_MINUTES = "cooldown_minutes"
        private const val KEY_INTERVAL = "interval"
        private const val KEY_SYMBOLS = "symbols"
    }
}
