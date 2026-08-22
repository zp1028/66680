package com.quant.app.data.network

import com.quant.app.data.config.ConfigStore
import com.quant.app.data.network.dto.AiSignalDto
import com.quant.app.data.network.dto.BreakoutDto
import com.quant.app.data.network.dto.DeepSeekChatRequest
import com.quant.app.data.network.dto.DeepSeekChatResponse
import com.quant.app.data.network.dto.NewsAnalysisDto
import com.quant.app.data.network.dto.TrendPredictionDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** DeepSeek API 异常。 */
class DeepSeekApiException(message: String) : IOException(message)

/**
 * DeepSeek Chat Completions 客户端(OpenAI 兼容协议)。
 * 统一要求模型输出 JSON(response_format=json_object),剥离 ```json 包裹后按目标类型校验。
 * 所有调用必须显式声明输入数据边界,禁止模型编造。
 */
class DeepSeekApiClient(
    private val configStore: ConfigStore,
    private val okHttp: OkHttpClient = defaultOkHttp(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * K线信号分析(S4)。
     * @throws DeepSeekApiException 网络/HTTP/解析/字段非法
     */
    suspend fun analyze(systemPrompt: String, userPrompt: String): AiSignalDto {
        val cleaned = chatRaw(systemPrompt, userPrompt, maxTokens = 1200)
        val signal = runCatching {
            json.decodeFromString(AiSignalDto.serializer(), cleaned)
        }.getOrElse {
            throw DeepSeekApiException("AI 输出无法解析为 JSON: ${cleaned.take(200)}")
        }
        if (!signal.isValid) {
            throw DeepSeekApiException("AI 输出字段非法: direction=${signal.direction}, confidence=${signal.confidence}")
        }
        return signal
    }

    /**
     * 新闻批量情绪分析(S9-A)。
     * @throws DeepSeekApiException 网络/HTTP/解析失败
     */
    suspend fun analyzeNews(systemPrompt: String, userPrompt: String): NewsAnalysisDto {
        val cleaned = chatRaw(systemPrompt, userPrompt, maxTokens = 1600)
        return runCatching {
            json.decodeFromString(NewsAnalysisDto.serializer(), cleaned)
        }.getOrElse {
            throw DeepSeekApiException("新闻分析输出无法解析为 JSON: ${cleaned.take(200)}")
        }
    }

    /**
     * 未来一周趋势线预测(S9-B)。
     * @throws DeepSeekApiException 网络/HTTP/解析/字段非法
     */
    suspend fun analyzeTrend(systemPrompt: String, userPrompt: String): TrendPredictionDto {
        val cleaned = chatRaw(systemPrompt, userPrompt, maxTokens = 1200)
        val dto = runCatching {
            json.decodeFromString(TrendPredictionDto.serializer(), cleaned)
        }.getOrElse {
            throw DeepSeekApiException("预测输出无法解析为 JSON: ${cleaned.take(200)}")
        }
        if (!dto.isValid) {
            throw DeepSeekApiException(
                "预测字段非法: prediction=${dto.prediction}, confidence=${dto.confidence}, points=${dto.dailyForecast.size}"
            )
        }
        return dto
    }

    /**
     * 趋势线破位解读(S9-C):结合行情与情报生成 80 字内解读。
     * @throws DeepSeekApiException 网络/HTTP/解析失败
     */
    suspend fun analyzeBreakout(systemPrompt: String, userPrompt: String): BreakoutDto {
        val cleaned = chatRaw(systemPrompt, userPrompt, maxTokens = 400)
        val dto = runCatching {
            json.decodeFromString(BreakoutDto.serializer(), cleaned)
        }.getOrElse {
            throw DeepSeekApiException("破位解读无法解析为 JSON: ${cleaned.take(200)}")
        }
        if (!dto.isValid) {
            throw DeepSeekApiException("破位解读为空")
        }
        return dto
    }

    /** 通用 JSON 输出调用:发请求 → 剥离代码块 → 返回纯净 JSON 字符串。 */
    private suspend fun chatRaw(systemPrompt: String, userPrompt: String, maxTokens: Int): String =
        withContext(Dispatchers.IO) {
            val apiKey = configStore.load().deepseekApiKey
            if (apiKey.isBlank()) {
                throw DeepSeekApiException("未配置 DeepSeek API Key")
            }

            val requestBody = json.encodeToString(
                DeepSeekChatRequest.serializer(),
                DeepSeekChatRequest(
                    maxTokens = maxTokens,
                    messages = listOf(
                        DeepSeekChatRequest.Message(role = "system", content = systemPrompt),
                        DeepSeekChatRequest.Message(role = "user", content = userPrompt),
                    ),
                ),
            )

            val request = Request.Builder()
                .url("$BASE_URL/chat/completions")
                .header("Authorization", "Bearer $apiKey")
                .header("Content-Type", "application/json")
                .post(requestBody.toRequestBody(JSON))
                .build()

            val body = okHttp.newCall(request).execute().use { response ->
                val text = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    throw DeepSeekApiException("DeepSeek HTTP ${response.code}: ${text.take(200)}")
                }
                text
            }

            val chat = json.decodeFromString(DeepSeekChatResponse.serializer(), body)
            val content = chat.choices.firstOrNull()?.message?.content ?: run {
                throw DeepSeekApiException("DeepSeek 返回空内容")
            }

            content
                .trim()
                .removePrefix("```json")
                .removePrefix("```")
                .removeSuffix("```")
                .trim()
        }

    companion object {
        private const val BASE_URL = "https://api.deepseek.com"
        private val JSON = "application/json; charset=utf-8".toMediaType()

        private fun defaultOkHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS) // LLM 生成耗时较长
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
