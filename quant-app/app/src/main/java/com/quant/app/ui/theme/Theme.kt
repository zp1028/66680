package com.quant.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = Color(0xFF22C55E),
    secondary = Color(0xFF3B82F6),
    error = Color(0xFFEF4444),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF16A34A),
    secondary = Color(0xFF2563EB),
    error = Color(0xFFDC2626),
)

@Composable
fun QuantTheme(content: @Composable () -> Unit) {
    // 默认深色主题(交易类 App 常见),后续可加系统跟随
    MaterialTheme(colorScheme = DarkColors, content = content)
}
