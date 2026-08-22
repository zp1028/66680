package com.quant.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quant.app.data.db.entity.AiAnalysisEntity
import com.quant.app.ui.MainViewModel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ReportScreen(viewModel: MainViewModel) {
    val analyses by viewModel.aiAnalyses.collectAsState()
    val config by viewModel.configState.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "AI 分析报告(模式:${if (config.autoTrade) "自动下单" else "建议模式"})",
            style = MaterialTheme.typography.titleMedium,
        )
        if (analyses.isEmpty()) {
            Text("暂无分析记录。启动引擎后,每根 K线收盘将生成一份报告。", color = Color.Gray)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(analyses, key = { it.id }) { analysis ->
                    AnalysisCard(analysis, config.autoTrade) { id, symbol, direction, confidence ->
                        viewModel.confirmTrade(symbol, id, direction, confidence)
                    }
                }
            }
        }
    }
}

@Composable
private fun AnalysisCard(
    analysis: AiAnalysisEntity,
    autoTrade: Boolean,
    onConfirm: (Long, String, String, Double) -> Unit,
) {
    val directionColor = when (analysis.direction) {
        "long" -> Color(0xFF22C55E)
        "short" -> Color(0xFFEF4444)
        else -> Color.Gray
    }
    val directionLabel = when (analysis.direction) {
        "long" -> "做多"
        "short" -> "做空"
        else -> "观望"
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("${analysis.symbol} · ${analysis.interval}", style = MaterialTheme.typography.titleSmall)
                Text(
                    formatTime(analysis.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray,
                )
            }
            Text(
                "$directionLabel 置信度 ${(analysis.confidence * 100).toInt()}%",
                color = directionColor,
                style = MaterialTheme.typography.titleSmall,
            )
            val details = buildList {
                analysis.entry?.let { add("入场 $it") }
                analysis.stopLoss?.let { add("止损 $it") }
                analysis.takeProfit?.let { add("止盈 $it") }
            }.joinToString("  ")
            if (details.isNotBlank()) {
                Text(details, style = MaterialTheme.typography.bodySmall)
            }
            analysis.outputJson.let { raw ->
                runCatching {
                    val reasons = Json.parseToJsonElement(raw).jsonObject["reasons"]?.toString()
                    if (!reasons.isNullOrBlank() && reasons != "[]") {
                        Text("依据:$reasons", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            // 建议模式 + 非观望 → 人工确认下单
            if (!autoTrade && analysis.direction != "neutral") {
                Button(
                    onClick = {
                        onConfirm(analysis.id, analysis.symbol, analysis.direction, analysis.confidence)
                    },
                    modifier = Modifier.padding(top = 4.dp),
                ) {
                    Text("确认按此信号开仓")
                }
            }
        }
    }
}

private fun formatTime(ts: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(ts))
