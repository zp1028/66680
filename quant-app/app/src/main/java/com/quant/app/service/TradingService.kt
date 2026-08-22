package com.quant.app.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import com.quant.app.QuantApplication
import com.quant.app.data.network.websocket.KlineStreamEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * 量化引擎前台服务(保活核心):
 * - 前台服务 + 常驻通知,降低被系统杀死的概率;
 * - 启动 K线订阅 → 每根 K线收盘触发 AI 分析 → 按模式(建议/自动)处理;
 * - START_STICKY:被系统回收后自动重启。
 */
class TradingService : Service() {

    private val app get() = application as QuantApplication
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var engineStarted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEngine()
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(
            NOTIFICATION_ID,
            NotificationHelper.statusNotification(this, "初始化中..."),
        )
        startEngine()
        return START_STICKY
    }

    override fun onDestroy() {
        stopEngine()
        scope.cancel()
        super.onDestroy()
    }

    private fun startEngine() {
        if (engineStarted) return
        val config = app.configStore.load()
        if (!config.isConfigured) {
            NotificationHelper.notifyAlert(this, "配置缺失", "请先在设置中填写 API Key 与 AI Key")
            updateStatus("未配置 API Key")
            return
        }
        engineStarted = true

        app.klineRepository.onKlineClosed = { event -> handleKlineClosed(event) }
        app.predictionAlertEngine.onAlert = { title, text ->
            NotificationHelper.notifyAlert(this@TradingService, title, text)
        }
        app.userDataStreamer.onStopLossTriggered = { symbol, orderId ->
            NotificationHelper.notifyAlert(
                this@TradingService,
                "止损已触发",
                "$symbol 止损单已成交(orderId=$orderId)",
            )
        }
        app.klineRepository.start(config.symbols, config.interval)
        app.userDataStreamer.start()
        app.pnlTracker.start()
        updateStatus("监控 ${config.symbols.joinToString()} · ${config.interval}")
    }

    private fun handleKlineClosed(event: KlineStreamEvent) {
        scope.launch {
            val config = app.configStore.load()
            val klines = app.klineRepository.getRecent(event.symbol, event.interval, 80)
            if (klines.size < 20) {
                android.util.Log.w(TAG, "${event.symbol} K线数据不足(${klines.size}),跳过分析")
                return@launch
            }
            try {
                // 1. 定时刷新新闻情报(内部限频)+ 预测破位检测/生成
                runCatching { app.newsRepository.refresh() }
                    .onFailure { e -> android.util.Log.w(TAG, "新闻刷新失败: ${e.message}") }
                app.predictionAlertEngine.onKlineClosed(event)

                // 2. AI 分析并落库(注入预测/情绪上下文)
                val signal = app.aiAnalysisRepository.analyzeAndStore(
                    event.symbol, event.interval, klines,
                    extraContext = app.predictionAlertEngine.signalContext(event.symbol),
                )
                NotificationHelper.notifyAiReport(this@TradingService, event.symbol, signal)

                // 2. 按模式处理
                if (config.autoTrade) {
                    // 自动模式:规则通过则直接下单
                    app.tradingOrchestrator.onAiSignal(
                        symbol = event.symbol,
                        signal = signal,
                        mode = "AUTO",
                        onResult = { result ->
                            NotificationHelper.notifyTrade(this@TradingService, event.symbol, result)
                        },
                    )
                }
                // 建议模式:仅通知,人工确认下单由 UI 触发(S7)
            } catch (e: Exception) {
                NotificationHelper.notifyAlert(this@TradingService, "AI 分析失败", e.message ?: "未知错误")
            }
        }
    }

    private fun stopEngine() {
        engineStarted = false
        app.klineRepository.stop()
        app.userDataStreamer.stop()
        app.pnlTracker.stop()
        app.predictionAlertEngine.onAlert = null
        app.userDataStreamer.onStopLossTriggered = null
    }

    private fun updateStatus(text: String) {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        manager?.notify(
            NOTIFICATION_ID,
            NotificationHelper.statusNotification(this, text),
        )
    }

    companion object {
        private const val TAG = "TradingService"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_STOP = "com.quant.app.action.STOP_TRADING"

        fun start(context: Context) {
            val intent = Intent(context, TradingService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, TradingService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
