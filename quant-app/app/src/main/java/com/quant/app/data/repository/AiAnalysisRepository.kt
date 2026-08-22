package com.quant.app.data.repository

import com.quant.app.data.ai.AiPromptBuilder
import com.quant.app.data.db.dao.AiAnalysisDao
import com.quant.app.data.db.entity.AiAnalysisEntity
import com.quant.app.data.db.entity.KlineEntity
import com.quant.app.data.network.DeepSeekApiClient
import com.quant.app.data.network.dto.AiSignalDto
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * AI 分析仓库:构建 prompt → 调 DeepSeek → 校验 → 落库。
 * 每次 K线收盘由引擎层调用(S5/S6)。
 */
class AiAnalysisRepository(
    private val deepSeek: DeepSeekApiClient,
    private val aiAnalysisDao: AiAnalysisDao,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** 对某币种执行一次 AI 分析并落库,返回结构化信号。extraContext 注入预测/情绪上下文(S9-C)。 */
    suspend fun analyzeAndStore(
        symbol: String,
        interval: String,
        klines: List<KlineEntity>,
        extraContext: String = "",
    ): AiSignalDto {
        val signal = deepSeek.analyze(
            systemPrompt = AiPromptBuilder.buildSystemPrompt(),
            userPrompt = AiPromptBuilder.buildUserPrompt(symbol, interval, klines, extraContext),
        )
        aiAnalysisDao.insert(
            AiAnalysisEntity(
                symbol = symbol,
                interval = interval,
                inputSummary = "klines=${klines.size}, lastClose=${klines.lastOrNull()?.close}",
                outputJson = json.encodeToString(AiSignalDto.serializer(), signal),
                direction = signal.direction,
                confidence = signal.confidence,
                entry = signal.entry,
                stopLoss = signal.stopLoss,
                takeProfit = signal.takeProfit,
                timestamp = System.currentTimeMillis(),
            )
        )
        return signal
    }

    fun observeAll(): Flow<List<AiAnalysisEntity>> = aiAnalysisDao.observeAll()

    suspend fun getRecent(limit: Int = 50): List<AiAnalysisEntity> =
        aiAnalysisDao.getRecent(limit)
}
