package com.quant.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import com.quant.app.data.db.entity.KlineEntity
import com.quant.app.data.network.dto.TrendPredictionDto
import kotlin.math.abs

/**
 * K线 + AI 预测线自绘组件(Compose Canvas,无第三方图表库)。
 * 上方价格区:蜡烛图 + MA5/MA10/MA20 均线 + AI 预测虚线(破位变红);
 * 下方成交量区:红绿成交量柱。
 */
@Composable
fun KlineChart(
    klines: List<KlineEntity>,
    forecast: List<TrendPredictionDto.DayForecast>,
    basePrice: Double,
    broken: Boolean,
    modifier: Modifier = Modifier,
) {
    val upColor = Color(0xFF22C55E)   // 涨(币安惯例绿涨)
    val downColor = Color(0xFFEF4444) // 跌
    val gridColor = Color(0xFFE5E7EB)
    val predictColor = if (broken) Color(0xFFEF4444) else Color(0xFF3B82F6)
    val ma5Color = Color(0xFFF59E0B)
    val ma10Color = Color(0xFF3B82F6)
    val ma20Color = Color(0xFFA855F7)

    Canvas(modifier = modifier) {
        if (klines.isEmpty()) return@Canvas
        val n = klines.size
        val extraSlots = 5
        val slotW = size.width / (n + extraSlots)

        // 价格区(上方 75%)与成交量区(下方 25%)
        val priceTop = 0f
        val priceBottom = size.height * 0.75f
        val priceH = priceBottom - priceTop
        val volTop = priceBottom
        val volBottom = size.height

        val allPrices = buildList {
            klines.forEach { add(it.high); add(it.low) }
            forecast.forEach { add(it.predictedClose) }
            add(basePrice)
        }
        val maxP = allPrices.max()
        val minP = allPrices.min()
        val pad = (maxP - minP) * 0.05
        val top = maxP + pad
        val bottom = (minP - pad).coerceAtLeast(0.0)
        fun yOf(p: Double): Float =
            priceTop + ((1 - (p - bottom) / (top - bottom)) * priceH).toFloat()

        // 水平网格(价格区)
        for (i in 0..4) {
            val gy = priceTop + priceH * i / 4
            drawLine(gridColor, Offset(0f, gy), Offset(size.width, gy), strokeWidth = 1f)
        }

        // 蜡烛
        val bodyW = slotW * 0.6f
        klines.forEachIndexed { i, k ->
            val x = slotW * (i + 0.5f)
            val up = k.close >= k.open
            val color = if (up) upColor else downColor
            val highY = yOf(k.high)
            val lowY = yOf(k.low)
            val openY = yOf(k.open)
            val closeY = yOf(k.close)
            drawLine(
                color = color,
                start = Offset(x, highY),
                end = Offset(x, lowY),
                strokeWidth = 1.5f,
            )
            val bodyTop = minOf(openY, closeY)
            val bodyH = abs(closeY - openY).coerceAtLeast(1f)
            drawRect(
                color = color,
                topLeft = Offset(x - bodyW / 2, bodyTop),
                size = Size(bodyW, bodyH),
            )
        }

        // MA 均线叠加
        drawMaLine(klines, 5, ma5Color, slotW, ::yOf)
        drawMaLine(klines, 10, ma10Color, slotW, ::yOf)
        drawMaLine(klines, 20, ma20Color, slotW, ::yOf)

        // AI 预测线(虚线):起点=最新收盘价,依次连接 5 个预测点
        if (forecast.isNotEmpty()) {
            val yValues = listOf(yOf(basePrice)) + forecast.map { yOf(it.predictedClose) }
            val path = Path()
            val startX = slotW * (n - 0.5f)
            path.moveTo(startX, yValues[0])
            forecast.forEachIndexed { i, _ ->
                path.lineTo(slotW * (n + i + 0.5f), yValues[i + 1])
            }
            drawPath(
                path = path,
                color = predictColor,
                style = Stroke(
                    width = 2.5f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 8f)),
                ),
            )
            val lastX = slotW * (n + forecast.size - 0.5f)
            drawCircle(
                color = predictColor,
                radius = 5f,
                center = Offset(lastX, yValues.last()),
            )
        }

        // 当前价基准虚线
        val baseY = yOf(basePrice)
        drawLine(
            color = Color(0xFF9CA3AF),
            start = Offset(0f, baseY),
            end = Offset(size.width, baseY),
            strokeWidth = 1f,
            cap = StrokeCap.Round,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 6f)),
        )

        // 成交量柱(下方 25%)
        val maxVol = klines.maxOf { it.volume }.coerceAtLeast(1.0)
        klines.forEachIndexed { i, k ->
            val x = slotW * (i + 0.5f)
            val up = k.close >= k.open
            val color = if (up) upColor.copy(alpha = 0.5f) else downColor.copy(alpha = 0.5f)
            val barH = (k.volume / maxVol * (volBottom - volTop)).toFloat()
            drawRect(
                color = color,
                topLeft = Offset(x - bodyW / 2, volBottom - barH),
                size = Size(bodyW, barH),
            )
        }
    }
}

/** 绘制一条 MA 均线(数据不足时跳过)。 */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawMaLine(
    klines: List<KlineEntity>,
    period: Int,
    color: Color,
    slotW: Float,
    yOf: (Double) -> Float,
) {
    if (klines.size < period) return
    val path = Path()
    var started = false
    for (i in period - 1 until klines.size) {
        val ma = klines.subList(i - period + 1, i + 1).map { it.close }.average()
        val x = slotW * (i + 0.5f)
        val y = yOf(ma)
        if (!started) {
            path.moveTo(x, y)
            started = true
        } else {
            path.lineTo(x, y)
        }
    }
    drawPath(path, color = color, style = Stroke(width = 1.5f))
}
