package com.quant.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.quant.app.MainActivity
import com.quant.app.R
import com.quant.app.data.network.dto.AiSignalDto
import com.quant.app.domain.trade.TradeResult

/**
 * 通知助手:渠道创建 + 各类通知发送。
 */
object NotificationHelper {

    const val CHANNEL_STATUS = "channel_status"
    const val CHANNEL_TRADE = "channel_trade"
    const val CHANNEL_ALERT = "channel_alert"

    private const val NOTIFICATION_ID_STATUS = 1
    private const val NOTIFICATION_ID_TRADE = 2
    private const val NOTIFICATION_ID_ALERT = 3
    private const val NOTIFICATION_ID_AI_REPORT = 4

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_STATUS, "运行状态", NotificationManager.IMPORTANCE_LOW)
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_TRADE, "交易通知", NotificationManager.IMPORTANCE_HIGH)
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERT, "风险告警", NotificationManager.IMPORTANCE_HIGH)
        )
    }

    /** 前台服务常驻状态通知。 */
    fun statusNotification(context: Context, text: String): Notification {
        val pendingIntent = appPendingIntent(context)
        return NotificationCompat.Builder(context, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_trading)
            .setContentTitle("量化引擎运行中")
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    /** AI 分析报告通知(建议模式点击打开 App)。 */
    fun notifyAiReport(context: Context, symbol: String, signal: AiSignalDto) {
        val text = when (signal.direction) {
            "long" -> "建议做多,置信度 ${(signal.confidence * 100).toInt()}%"
            "short" -> "建议做空,置信度 ${(signal.confidence * 100).toInt()}%"
            else -> "观望(neutral)"
        }
        send(
            context,
            CHANNEL_TRADE,
            NOTIFICATION_ID_AI_REPORT,
            "AI 分析 · $symbol",
            "$text\n${signal.riskWarning}",
        )
    }

    /** 交易结果通知。 */
    fun notifyTrade(context: Context, symbol: String, result: TradeResult) {
        when (result) {
            is TradeResult.Success -> send(
                context, CHANNEL_TRADE, NOTIFICATION_ID_TRADE,
                "开仓成功 · $symbol",
                "${result.trade.side} ${result.trade.qty} @ ${result.trade.price}(${result.trade.mode})",
            )
            is TradeResult.Failure -> send(
                context, CHANNEL_ALERT, NOTIFICATION_ID_ALERT,
                "开仓失败 · $symbol",
                result.reason,
            )
        }
    }

    /** 风险/状态告警。 */
    fun notifyAlert(context: Context, title: String, text: String) {
        send(context, CHANNEL_ALERT, NOTIFICATION_ID_ALERT, title, text)
    }

    private fun send(context: Context, channel: String, id: Int, title: String, text: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_trading)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(appPendingIntent(context))
            .setAutoCancel(true)
            .build()
        manager.notify(id, notification)
    }

    private fun appPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
