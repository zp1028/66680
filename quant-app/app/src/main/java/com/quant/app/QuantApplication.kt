package com.quant.app

import android.app.Application
import com.quant.app.data.config.ConfigStore
import com.quant.app.data.db.QuantDatabase
import com.quant.app.data.network.BinanceApiClient
import com.quant.app.data.network.BinanceRateLimiter
import com.quant.app.data.network.DeepSeekApiClient
import com.quant.app.data.network.websocket.KlineStreamer
import com.quant.app.data.network.websocket.UserDataStreamer
import com.quant.app.data.repository.AiAnalysisRepository
import com.quant.app.data.repository.KlineRepository
import com.quant.app.data.repository.NewsRepository
import com.quant.app.data.news.NewsFetcher
import com.quant.app.domain.predict.PredictionAlertEngine
import com.quant.app.domain.predict.PredictionValidator
import com.quant.app.domain.predict.TrendPredictor
import com.quant.app.domain.pnl.PnlTracker
import com.quant.app.domain.trade.RiskManager
import com.quant.app.domain.trade.SignalEngine
import com.quant.app.domain.trade.TradeExecutor
import com.quant.app.domain.trade.TradingOrchestrator

/**
 * 应用入口,持有全局单例(数据库 / 配置存储 / 网络客户端 / 仓库 / 交易引擎)。
 * 后续 S6~S8 的服务与 UI 状态也统一在此装配。
 */
class QuantApplication : Application() {

    lateinit var database: QuantDatabase
        private set
    lateinit var configStore: ConfigStore
        private set
    lateinit var binanceApi: BinanceApiClient
        private set
    lateinit var deepSeekApi: DeepSeekApiClient
        private set
    lateinit var klineRepository: KlineRepository
        private set
    lateinit var aiAnalysisRepository: AiAnalysisRepository
        private set
    lateinit var newsRepository: NewsRepository
        private set
    lateinit var trendPredictor: TrendPredictor
        private set
    lateinit var predictionValidator: PredictionValidator
        private set
    lateinit var predictionAlertEngine: PredictionAlertEngine
        private set
    lateinit var userDataStreamer: UserDataStreamer
        private set
    lateinit var pnlTracker: PnlTracker
        private set
    lateinit var riskManager: RiskManager
        private set
    lateinit var signalEngine: SignalEngine
        private set
    lateinit var tradeExecutor: TradeExecutor
        private set
    lateinit var tradingOrchestrator: TradingOrchestrator
        private set

    override fun onCreate() {
        super.onCreate()
        database = QuantDatabase.get(this)
        configStore = ConfigStore(this)
        binanceApi = BinanceApiClient(
            configStore = configStore,
            rateLimiter = BinanceRateLimiter(),
        )
        deepSeekApi = DeepSeekApiClient(configStore = configStore)
        klineRepository = KlineRepository(
            api = binanceApi,
            klineDao = database.klineDao(),
            streamer = KlineStreamer(modeProvider = { configStore.load().mode }),
        )
        aiAnalysisRepository = AiAnalysisRepository(
            deepSeek = deepSeekApi,
            aiAnalysisDao = database.aiAnalysisDao(),
        )
        newsRepository = NewsRepository(
            fetcher = NewsFetcher(),
            deepSeek = deepSeekApi,
            newsDao = database.newsDao(),
        )
        trendPredictor = TrendPredictor(
            deepSeek = deepSeekApi,
            dao = database.trendPredictionDao(),
        )
        predictionValidator = PredictionValidator()
        predictionAlertEngine = PredictionAlertEngine(
            predictor = trendPredictor,
            validator = predictionValidator,
            dao = database.trendPredictionDao(),
            klineRepository = klineRepository,
            newsRepository = newsRepository,
            deepSeek = deepSeekApi,
        )
        userDataStreamer = UserDataStreamer(
            api = binanceApi,
            tradeDao = database.tradeDao(),
            modeProvider = { configStore.load().mode },
        )
        pnlTracker = PnlTracker(
            api = binanceApi,
            tradeDao = database.tradeDao(),
            configStore = configStore,
        )
        riskManager = RiskManager(configStore = configStore, api = binanceApi)
        signalEngine = SignalEngine(
            configStore = configStore,
            riskManager = riskManager,
            api = binanceApi,
        )
        tradeExecutor = TradeExecutor(
            configStore = configStore,
            api = binanceApi,
            riskManager = riskManager,
            tradeDao = database.tradeDao(),
        )
        tradingOrchestrator = TradingOrchestrator(
            engine = signalEngine,
            executor = tradeExecutor,
        )
    }
}
