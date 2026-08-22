package com.quant.app.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quant.app.data.db.entity.NewsEntity
import com.quant.app.data.db.entity.TrendPredictionEntity
import com.quant.app.domain.pnl.PnlSummary
import com.quant.app.ui.MainViewModel
import com.quant.app.ui.components.KlineChart
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 情报页:K线 + AI 一周预测线 + 预测详情 + 市场新闻流。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IntelligenceScreen(viewModel: MainViewModel) {
    val config by viewModel.configState.collectAsState()
    val selected by viewModel.selectedSymbol.collectAsState()
    val klines by viewModel.klines.collectAsState()
    val prediction by viewModel.latestPrediction.collectAsState()
    val forecast by viewModel.latestForecast.collectAsState()
    val news by viewModel.news.collectAsState()
    val accuracy by viewModel.accuracy.collectAsState()
    val pnl by viewModel.pnlSummary.collectAsState()
    val message by viewModel.message.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 币种切换
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            config.symbols.forEach { symbol ->
                FilterChip(
                    selected = symbol == selected,
                    onClick = { viewModel.selectSymbol(symbol) },
                    label = { Text(symbol.removeSuffix("USDT")) },
                )
            }
        }

        // K线 + 预测线
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("$selected · 历史K线 + AI一周预测线", style = MaterialTheme.typography.titleSmall)
                KlineChart(
                    klines = klines,
                    forecast = forecast,
                    basePrice = prediction?.basePrice ?: klines.lastOrNull()?.close ?: 0.0,
                    broken = prediction?.status == "broken",
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(220.dp),
                )
                PredictionStatusText(prediction, forecast)
            }
        }

        // 预测详情与操作
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("AI 一周预测", style = MaterialTheme.typography.titleSmall)
                    Row {
                        TextButton(onClick = { viewModel.refreshNews() }) { Text("刷新情报") }
                        TextButton(onClick = { viewModel.regeneratePrediction() }) { Text("重新预测") }
                    }
                }
                prediction?.let { p ->
                    Text(
                        "方向:${predLabel(p.prediction)} · 置信度 ${(p.confidence * 100).toInt()}%",
                        style = MaterialTheme.typography.bodyMedium,
                        color = predColor(p.prediction),
                    )
                    if (p.keyDriver.isNotBlank()) {
                        Text("核心驱动:${p.keyDriver}", style = MaterialTheme.typography.bodySmall)
                    }
                    if (p.risks.isNotBlank()) {
                        Text("风险:${p.risks}", style = MaterialTheme.typography.bodySmall)
                    }
                    forecast.take(5).forEach { f ->
                        Text(
                            "第${f.day}交易日 预测价 ${fmtPrice(f.predictedClose)}${if (f.note.isNotBlank()) " · ${f.note}" else ""}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.Gray,
                        )
                    }
                } ?: Text("暂无预测。启动引擎后每个交易日收盘自动生成,或点击「重新预测」。", color = Color.Gray)
                Text("回测统计:${accuracy.label}", style = MaterialTheme.typography.bodySmall)
            }
        }

        // 盈亏统计
        PnlSummaryCard(pnl)

        // 市场情报
        Text("市场情报(${news.size})", style = MaterialTheme.typography.titleMedium)
        if (news.isEmpty()) {
            Text("暂无新闻。点击「刷新情报」或启动引擎后自动抓取。", color = Color.Gray)
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(news, key = { it.link }) { item -> NewsRow(item) }
            }
        }
    }

    SnackbarHost(hostState = snackbarHostState)
}

@Composable
private fun PredictionStatusText(
    prediction: TrendPredictionEntity?,
    forecast: List<com.quant.app.data.network.dto.TrendPredictionDto.DayForecast>,
) {
    when {
        prediction == null -> Text(
            "暂无 AI 预测线(启动引擎后交易日收盘自动生成)",
            style = MaterialTheme.typography.bodySmall,
            color = Color.Gray,
        )
        prediction.status == "broken" -> Text(
            "状态:预测线已跌破(${prediction.breakNote})",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFFEF4444),
        )
        else -> {
            val today = forecast.firstOrNull()
            val todayText = today?.let { "今日预测价 ${fmtPrice(it.predictedClose)}" } ?: ""
            Text(
                "状态:预测进行中 · $todayText",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF3B82F6),
            )
        }
    }
}

@Composable
private fun PnlSummaryCard(pnl: PnlSummary) {
    val pnlColor = if (pnl.totalRealizedPnl >= 0) Color(0xFF22C55E) else Color(0xFFEF4444)
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("盈亏统计", style = MaterialTheme.typography.titleSmall)
                Text(
                    "总盈亏 ${fmtPnl(pnl.totalRealizedPnl)}",
                    style = MaterialTheme.typography.titleSmall,
                    color = pnlColor,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("已平仓 ${pnl.closedCount} 笔", style = MaterialTheme.typography.bodySmall)
                Text("胜率 ${(pnl.winRate * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
                Text("最大盈 ${fmtPnl(pnl.maxProfit)}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF22C55E))
                Text("最大亏 ${fmtPnl(pnl.maxLoss)}", style = MaterialTheme.typography.bodySmall, color = Color(0xFFEF4444))
            }
            if (pnl.bySymbol.isNotEmpty()) {
                pnl.bySymbol.take(5).forEach { s ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(s.symbol, style = MaterialTheme.typography.bodySmall)
                        Text(
                            "${fmtPnl(s.realizedPnl)} · ${s.closedCount}笔 · 胜率${(s.winRate * 100).toInt()}%",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (s.realizedPnl >= 0) Color(0xFF22C55E) else Color(0xFFEF4444),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NewsRow(item: NewsEntity) {
    val (label, color) = when (item.sentiment) {
        "bullish" -> "利多" to Color(0xFF22C55E)
        "bearish" -> "利空" to Color(0xFFEF4444)
        else -> "中性" to Color.Gray
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("[$label]", color = color, style = MaterialTheme.typography.labelMedium)
                Text(
                    "${item.source} · ${formatTime(item.pubTime)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray,
                )
            }
            Text(item.title, style = MaterialTheme.typography.bodyMedium)
            if (item.category.isNotBlank()) {
                Text("分类:${item.category}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        }
    }
}

private fun predLabel(p: String): String = when (p) {
    "up" -> "看涨"
    "down" -> "看跌"
    else -> "震荡"
}

private fun predColor(p: String): Color = when (p) {
    "up" -> Color(0xFF22C55E)
    "down" -> Color(0xFFEF4444)
    else -> Color.Gray
}

private fun fmtPrice(v: Double): String = if (v == v.toLong().toDouble()) {
    v.toLong().toString()
} else {
    "%.2f".format(v)
}

private fun fmtPnl(v: Double): String = if (v >= 0) "+%.2f".format(v) else "%.2f".format(v)

private fun formatTime(ts: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(ts))
