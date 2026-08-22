package com.quant.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quant.app.data.db.entity.TradeEntity
import com.quant.app.domain.pnl.PnlSummary
import com.quant.app.ui.MainViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HistoryScreen(viewModel: MainViewModel) {
    val trades by viewModel.trades.collectAsState()
    val pnl by viewModel.pnlSummary.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PnlOverview(pnl)
        Text("交易历史(${trades.size})", style = MaterialTheme.typography.titleMedium)
        if (trades.isEmpty()) {
            Text("暂无交易记录", color = Color.Gray)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(trades, key = { it.orderId }) { trade ->
                    TradeCard(trade)
                }
            }
        }
    }
}

@Composable
private fun PnlOverview(pnl: PnlSummary) {
    val pnlColor = if (pnl.totalRealizedPnl >= 0) Color(0xFF22C55E) else Color(0xFFEF4444)
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("盈亏概览", style = MaterialTheme.typography.titleSmall)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "总盈亏 ${fmtPnl(pnl.totalRealizedPnl)}",
                    style = MaterialTheme.typography.titleMedium,
                    color = pnlColor,
                )
                Text("胜率 ${(pnl.winRate * 100).toInt()}%", style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                "已平仓 ${pnl.closedCount} 笔(盈 ${pnl.winCount} / 亏 ${pnl.lossCount}) · 最大盈 ${fmtPnl(pnl.maxProfit)} · 最大亏 ${fmtPnl(pnl.maxLoss)}",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray,
            )
        }
    }
}

@Composable
private fun TradeCard(trade: TradeEntity) {
    val isBuy = trade.side == "BUY"
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${trade.symbol} · ${if (isBuy) "买入" else "卖出"}",
                    style = MaterialTheme.typography.titleSmall,
                    color = if (isBuy) Color(0xFF22C55E) else Color(0xFFEF4444),
                )
                Text(
                    "${trade.mode} · ${trade.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray,
                )
            }
            Text(
                "数量 ${trade.qty} @ ${trade.price} · 杠杆 ${trade.leverage}x",
                style = MaterialTheme.typography.bodySmall,
            )
            trade.stopLossPrice?.let {
                Text("止损单:$it", style = MaterialTheme.typography.bodySmall)
            }
            Text(
                formatTime(trade.timestamp),
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray,
            )
        }
    }
}

private fun formatTime(ts: Long): String =
    SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault()).format(Date(ts))

private fun fmtPnl(v: Double): String = if (v >= 0) "+%.2f".format(v) else "%.2f".format(v)
