package com.quant.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.quant.app.domain.model.AppConfig
import com.quant.app.domain.model.TradingMode
import com.quant.app.ui.MainViewModel
import com.quant.app.util.BatteryOptimizationHelper

@Composable
fun SettingsScreen(viewModel: MainViewModel) {
    val config by viewModel.configState.collectAsState()
    val context = LocalContext.current

    var testnetApiKey by remember { mutableStateOf(config.testnetApiKey) }
    var testnetSecret by remember { mutableStateOf(config.testnetSecretKey) }
    var liveApiKey by remember { mutableStateOf(config.liveApiKey) }
    var liveSecret by remember { mutableStateOf(config.liveSecretKey) }
    var deepseekKey by remember { mutableStateOf(config.deepseekApiKey) }
    var mode by remember { mutableStateOf(config.mode) }
    var autoTrade by remember { mutableStateOf(config.autoTrade) }
    var showLiveConfirm by remember { mutableStateOf(false) }
    var threshold by remember { mutableStateOf(config.confidenceThreshold.toString()) }
    var leverage by remember { mutableStateOf(config.leverage.toString()) }
    var maxPosition by remember { mutableStateOf(config.maxPositionUsd.toString()) }
    var maxLoss by remember { mutableStateOf(config.maxDailyLossPct.toString()) }
    var cooldown by remember { mutableStateOf(config.cooldownMinutes.toString()) }
    var interval by remember { mutableStateOf(config.interval) }
    var symbols by remember { mutableStateOf(config.symbols.joinToString(",")) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("设置", style = MaterialTheme.typography.titleLarge)

        // ---- 密钥 ----
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("API 密钥(加密存储,测试网/实盘隔离)", style = MaterialTheme.typography.titleSmall)
                Text("测试网 Key(testnet.binancefuture.com)", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = testnetApiKey,
                    onValueChange = { testnetApiKey = it },
                    label = { Text("测试网 API Key") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = testnetSecret,
                    onValueChange = { testnetSecret = it },
                    label = { Text("测试网 Secret Key") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("实盘 Key(fapi.binance.com)", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = liveApiKey,
                    onValueChange = { liveApiKey = it },
                    label = { Text("实盘 API Key") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = liveSecret,
                    onValueChange = { liveSecret = it },
                    label = { Text("实盘 Secret Key") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = deepseekKey,
                    onValueChange = { deepseekKey = it },
                    label = { Text("DeepSeek API Key(共享)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // ---- 交易模式 ----
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("交易模式", style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    ModeChip("测试网", TradingMode.TESTNET, mode) { mode = TradingMode.TESTNET }
                    ModeChip("实盘", TradingMode.LIVE, mode) { showLiveConfirm = true }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text("自动下单", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "关闭=仅出建议人工确认(推荐);开启=AI 信号自动下单",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = autoTrade, onCheckedChange = { autoTrade = it })
                }
            }
        }

        // ---- 策略参数 ----
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("策略与风控参数", style = MaterialTheme.typography.titleSmall)
                OutlinedTextField(
                    value = threshold,
                    onValueChange = { threshold = it },
                    label = { Text("置信度阈值(0~1,默认0.7)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = leverage,
                    onValueChange = { leverage = it },
                    label = { Text("杠杆倍数(1~125)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = maxPosition,
                    onValueChange = { maxPosition = it },
                    label = { Text("单笔保证金上限 USDT") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = maxLoss,
                    onValueChange = { maxLoss = it },
                    label = { Text("当日亏损熔断 %") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cooldown,
                    onValueChange = { cooldown = it },
                    label = { Text("同币种冷却(分钟)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = interval,
                    onValueChange = { interval = it },
                    label = { Text("K线周期(如 15m/1h/4h/1d)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = symbols,
                    onValueChange = { symbols = it },
                    label = { Text("监控币种(逗号分隔,如 BTCUSDT,ETHUSDT)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // ---- 保存与系统设置 ----
        Button(
            onClick = {
                val saved = config.copy(
                    testnetApiKey = testnetApiKey.trim(),
                    testnetSecretKey = testnetSecret.trim(),
                    liveApiKey = liveApiKey.trim(),
                    liveSecretKey = liveSecret.trim(),
                    deepseekApiKey = deepseekKey.trim(),
                    mode = mode,
                    autoTrade = autoTrade,
                    confidenceThreshold = threshold.toDoubleOrNull()?.coerceIn(0.0, 1.0) ?: 0.7,
                    leverage = leverage.toIntOrNull()?.coerceIn(1, 125) ?: 3,
                    maxPositionUsd = maxPosition.toDoubleOrNull() ?: 100.0,
                    maxDailyLossPct = maxLoss.toDoubleOrNull() ?: 5.0,
                    cooldownMinutes = cooldown.toIntOrNull() ?: 30,
                    interval = interval.trim().ifBlank { "15m" },
                    symbols = symbols.split(",").map { it.trim() }.filter { it.isNotBlank() }
                        .ifEmpty { listOf("BTCUSDT") },
                )
                viewModel.saveConfig(saved)
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("保存配置")
        }

        OutlinedButton(
            onClick = {
                BatteryOptimizationHelper.requestIgnoreBatteryOptimizations(context)
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("引导加入电池白名单(保活)")
        }

        val ignoring = remember {
            BatteryOptimizationHelper.isIgnoringBatteryOptimizations(context)
        }
        Text(
            "电池优化状态:${if (ignoring) "已忽略" else "未忽略(建议开启)"}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "安全提醒:币安 API Key 请勿开通提现权限;更换设备需重新填写密钥。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    if (showLiveConfirm) {
        AlertDialog(
            onDismissRequest = { showLiveConfirm = false },
            title = { Text("切换到实盘?") },
            text = {
                Text(
                    "实盘模式将使用真实资金交易(fapi.binance.com)。\n\n" +
                        "请确认:\n" +
                        "1. 已填写实盘 API Key 且未开通提现权限;\n" +
                        "2. 已理解强平、资金费率与本金亏损风险;\n" +
                        "3. 建议先在测试网充分验证后小资金实盘。"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    mode = TradingMode.LIVE
                    showLiveConfirm = false
                }) {
                    Text("确认切换")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLiveConfirm = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun ModeChip(
    label: String,
    mode: TradingMode,
    current: TradingMode,
    onSelect: () -> Unit,
) {
    val selected = current == mode
    if (selected) {
        Button(onClick = onSelect) { Text(label) }
    } else {
        OutlinedButton(onClick = onSelect) { Text(label) }
    }
}
