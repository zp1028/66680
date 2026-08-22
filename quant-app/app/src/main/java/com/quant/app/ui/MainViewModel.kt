package com.quant.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.quant.app.QuantApplication
import com.quant.app.data.db.entity.AiAnalysisEntity
import com.quant.app.data.db.entity.KlineEntity
import com.quant.app.data.db.entity.NewsEntity
import com.quant.app.data.db.entity.TradeEntity
import com.quant.app.data.db.entity.TrendPredictionEntity
import com.quant.app.data.network.dto.AccountDto
import com.quant.app.data.network.dto.PositionDto
import com.quant.app.data.network.dto.TrendPredictionDto
import com.quant.app.domain.model.AppConfig
import com.quant.app.domain.predict.AccuracyStats
import com.quant.app.domain.pnl.PnlSummary
import com.quant.app.domain.trade.TradeResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * 主 ViewModel:聚合配置、账户/持仓轮询、AI 报告、交易历史、情报与预测。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val app get() = getApplication<QuantApplication>()

    private val _config = MutableStateFlow(app.configStore.load())
    val configState: StateFlow<AppConfig> = _config.asStateFlow()

    private val _account = MutableStateFlow<AccountDto?>(null)
    val account: StateFlow<AccountDto?> = _account.asStateFlow()

    private val _positions = MutableStateFlow<List<PositionDto>>(emptyList())
    val positions: StateFlow<List<PositionDto>> = _positions.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    // ---------- 情报与预测 ----------

    private val initialSymbol = app.configStore.load().symbols.firstOrNull() ?: "BTCUSDT"
    private val _selectedSymbol = MutableStateFlow(initialSymbol)
    val selectedSymbol: StateFlow<String> = _selectedSymbol.asStateFlow()

    val klines: StateFlow<List<KlineEntity>> = _selectedSymbol
        .flatMapLatest { sym ->
            app.klineRepository.observeRecent(sym, _config.value.interval, 80)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val latestPrediction: StateFlow<TrendPredictionEntity?> = _selectedSymbol
        .flatMapLatest { sym -> app.database.trendPredictionDao().observeLatest(sym) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val latestForecast: StateFlow<List<TrendPredictionDto.DayForecast>> = latestPrediction
        .map { it?.let { p -> app.predictionValidator.parseForecast(p) } ?: emptyList() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val news: StateFlow<List<NewsEntity>> = app.newsRepository.observeNews(50)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _accuracy = MutableStateFlow(AccuracyStats(0, 0, 0.0))
    val accuracy: StateFlow<AccuracyStats> = _accuracy.asStateFlow()

    val aiAnalyses: StateFlow<List<AiAnalysisEntity>> = app.aiAnalysisRepository.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val trades: StateFlow<List<TradeEntity>> = app.database.tradeDao().observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _pnlSummary = MutableStateFlow(
        PnlSummary(0.0, 0, 0, 0.0, 0.0, 0.0, emptyList()),
    )
    val pnlSummary: StateFlow<PnlSummary> = _pnlSummary.asStateFlow()

    init {
        refreshAccount()
        viewModelScope.launch {
            _accuracy.value = app.predictionAlertEngine.accuracyStats()
        }
        // 交易记录变化时刷新盈亏汇总
        viewModelScope.launch {
            app.database.tradeDao().observeAll().collect {
                _pnlSummary.value = app.pnlTracker.summary()
            }
        }
    }

    fun selectSymbol(symbol: String) {
        _selectedSymbol.value = symbol
    }

    /** 手动刷新新闻情报。 */
    fun refreshNews() {
        viewModelScope.launch {
            runCatching { app.newsRepository.refresh() }
                .onSuccess { _message.value = "情报已刷新" }
                .onFailure { e -> _message.value = "情报刷新失败: ${e.message}" }
        }
    }

    /** 手动重新生成当前币种的预测趋势线。 */
    fun regeneratePrediction() {
        viewModelScope.launch {
            runCatching {
                app.predictionAlertEngine.generatePrediction(_selectedSymbol.value, _config.value.interval)
            }.onSuccess {
                _message.value = "已重新生成预测"
                _accuracy.value = app.predictionAlertEngine.accuracyStats()
            }.onFailure { e ->
                _message.value = "预测生成失败: ${e.message}"
            }
        }
    }

    // ---------- 原有功能 ----------

    fun reloadConfig() {
        _config.value = app.configStore.load()
    }

    fun saveConfig(config: AppConfig) {
        app.configStore.save(config)
        reloadConfig()
    }

    /** 轮询账户与持仓。 */
    fun refreshAccount() {
        viewModelScope.launch {
            _loading.value = true
            runCatching { app.binanceApi.account() }
                .onSuccess { acc ->
                    _account.value = acc
                    _positions.value = acc.positions.filter { it.isOpen }
                }
                .onFailure { e ->
                    _message.value = "账户查询失败: ${e.message}"
                }
            _loading.value = false
        }
    }

    /** 启动量化引擎(前台服务)。 */
    fun startEngine() {
        viewModelScope.launch {
            val config = _config.value
            if (!config.isConfigured) {
                _message.value = "请先在设置页填写 API Key 与 AI Key"
                return@launch
            }
            com.quant.app.service.TradingService.start(getApplication())
            _message.value = "引擎已启动(${config.mode.label})"
        }
    }

    fun stopEngine() {
        com.quant.app.service.TradingService.stop(getApplication())
        _message.value = "引擎已停止"
    }

    /** 人工确认下单(建议模式):取该条分析记录执行。 */
    fun confirmTrade(symbol: String, analysisId: Long, direction: String, confidence: Double) {
        viewModelScope.launch {
            val config = _config.value
            if (!config.isConfigured) {
                _message.value = "未配置 API Key,无法下单"
                return@launch
            }
            val analyses = app.aiAnalysisRepository.getRecent(100)
            val target = analyses.firstOrNull { it.id == analysisId }
                ?: run {
                    _message.value = "分析记录不存在"
                    return@launch
                }
            val signal = com.quant.app.data.network.dto.AiSignalDto(
                direction = target.direction,
                confidence = target.confidence,
                entry = target.entry,
                stopLoss = target.stopLoss,
                takeProfit = target.takeProfit,
                reasons = listOf("人工确认"),
            )
            app.tradingOrchestrator.onAiSignal(
                symbol = target.symbol,
                signal = signal,
                mode = "MANUAL",
                onResult = { result ->
                    _message.value = when (result) {
                        is TradeResult.Success -> "开仓成功 ${target.symbol} ${result.trade.side}"
                        is TradeResult.Failure -> "开仓失败: ${result.reason}"
                    }
                },
            )
        }
    }

    fun clearMessage() {
        _message.value = null
    }
}
