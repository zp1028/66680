package com.quant.app.ui.screens

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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quant.app.data.network.dto.PositionDto
import com.quant.app.ui.MainViewModel

@Composable
fun HomeScreen(viewModel: MainViewModel) {
    val config by viewModel.configState.collectAsState()
    val account by viewModel.account.collectAsState()
    val positions by viewModel.positions.collectAsState()
    val loading by viewModel.loading.collectAsState()
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
        // 引擎控制
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("量化引擎", style = MaterialTheme.typography.titleMedium)
                Text("模式:${config.mode.label} · 周期:${config.interval}")
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(onClick = { viewModel.startEngine() }, enabled = !loading) {
                        Text("启动引擎")
                    }
                    OutlinedButton(onClick = { viewModel.stopEngine() }) {
                        Text("停止")
                    }
                    OutlinedButton(onClick = { viewModel.refreshAccount() }, enabled = !loading) {
                        Text(if (loading) "刷新中..." else "刷新")
                    }
                }
            }
        }

        // 账户余额
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("账户", style = MaterialTheme.typography.titleMedium)
                if (account == null) {
                    Text("尚未获取到账户数据(需在设置中填写 API Key)", color = Color.Gray)
                } else {
                    val acc = account!!
                    Text("钱包余额:${acc.totalWalletBalance}")
                    Text("可用余额:${acc.availableBalance}")
                    Text(
                        "未实现盈亏:${acc.totalUnrealizedProfit}",
                        color = if (acc.totalUnrealizedProfit.toDoubleOrNull() ?: 0.0 >= 0) {
                            Color(0xFF22C55E)
                        } else {
                            Color(0xFFEF4444)
                        },
                    )
                }
            }
        }

        // 持仓列表
        Text("当前持仓(${positions.size})", style = MaterialTheme.typography.titleMedium)
        if (positions.isEmpty()) {
            Text("暂无持仓", color = Color.Gray)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(positions, key = { it.symbol + it.positionSide }) { pos ->
                    PositionCard(pos)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }

    SnackbarHost(hostState = snackbarHostState)
}

@Composable
private fun PositionCard(pos: PositionDto) {
    val pnl = pos.unRealizedProfit.toDoubleOrNull() ?: 0.0
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("${pos.symbol} · ${pos.positionSide}", style = MaterialTheme.typography.titleSmall)
                Text(
                    "${pos.positionAmt}",
                    color = if (pos.positionAmt.startsWith("-")) Color(0xFFEF4444) else Color(0xFF22C55E),
                )
            }
            Text("入场 ${pos.entryPrice}  标记 ${pos.markPrice}", style = MaterialTheme.typography.bodySmall)
            Text(
                "未实现盈亏 ${pos.unRealizedProfit} USDT",
                color = if (pnl >= 0) Color(0xFF22C55E) else Color(0xFFEF4444),
                style = MaterialTheme.typography.bodySmall,
            )
            Text("杠杆 ${pos.leverage}x · 强平价 ${pos.liquidationPrice}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
