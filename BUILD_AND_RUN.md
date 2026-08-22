# Quant App - APK 打包和运行指南

## 📋 项目信息
- **项目名**: 量化交易 App (Quant App)
- **开发语言**: Kotlin
- **构建系统**: Gradle
- **最低 API**: 应配置为 API 21+
- **目标 API**: API 34+

## 🔧 前置条件

### 1. 安装必需工具
```bash
# 1. 安装 Android SDK
# 下载 Android Studio: https://developer.android.com/studio

# 2. 设置环境变量 (Linux/Mac)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools

# 或 Windows
set ANDROID_HOME=C:\Users\<YourUsername>\AppData\Local\Android\Sdk
set PATH=%PATH%;%ANDROID_HOME%\tools;%ANDROID_HOME%\platform-tools
```

### 2. 检查 Java 版本
```bash
java -version
# 需要 JDK 11+ 或 17+
```

## 📦 提取和准备项目

### 第一步：解压 ZIP 文件
```bash
# 解压项目
unzip quant-app-fixed.zip

# 进入项目目录
cd quant-app
```

## 🏗️ 构建 APK

### 方法 1：使用 Gradle (推荐)

```bash
# 1. 清理旧构建
./gradlew clean

# 2. 检查依赖 (可选)
./gradlew dependencies

# 3. 构建 Debug APK
./gradlew assembleDebug

# 输出路径: app/build/outputs/apk/debug/app-debug.apk

# 或者构建 Release APK (需要签名配置)
./gradlew assembleRelease
```

### 方法 2：使用 Android Studio

1. 打开 Android Studio
2. 选择 "File" → "Open"
3. 选择 `quant-app` 文件夹
4. 等待 Gradle 同步完成
5. 选择 "Build" → "Build Bundle(s) / APK(s)" → "Build APK(s)"
6. 在左下角的 "Build Output" 中找到生成的 APK 文件

## 📱 运行 APK

### 方法 1：真实设备

```bash
# 1. 启用开发者模式 (设置 → 关于手机 → 连续点击"版本号")
# 2. 启用 USB 调试
# 3. 连接设备并授予权限

# 4. 检查设备连接
adb devices

# 5. 安装并运行
./gradlew installDebug
./gradlew runDebug
```

### 方法 2：Android 模拟器

```bash
# 1. 打开 Android Studio
# 2. 选择 "Device Manager" → 创建虚拟设备
# 3. 选择合适的系统镜像 (API 30+)
# 4. 启动模拟器

# 5. 运行 App
./gradlew installDebug
./gradlew runDebug

# 或者通过 adb 直接安装
adb install app/build/outputs/apk/debug/app-debug.apk
```

### 方法 3：手动安装 APK

```bash
# 在真实设备或模拟器上安装 APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 查看安装日志
adb logcat

# 启动应用
adb shell am start -n com.quant.app/.MainActivity
```

## 🔐 Release 构建 (发布版本)

### 签名配置

创建 `keystore` 文件 (一次性):
```bash
keytool -genkey -v -keystore my-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias my-key-alias
```

编辑 `app/build.gradle.kts` 添加签名配置:
```kotlin
android {
    signingConfigs {
        release {
            storeFile = file("../my-release-key.keystore")
            storePassword = "your_password"
            keyAlias = "my-key-alias"
            keyPassword = "your_password"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.release
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
```

构建 Release APK:
```bash
./gradlew assembleRelease
```

## 📊 项目结构

```
quant-app/
├── app/                          # 主应用模块
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/
│   │   │   │   └── com/quant/app/
│   │   │   │       ├── data/        # 数据层 (DB, Network, Repository)
│   │   │   │       ├── domain/      # 业务逻辑层 (Models, PnL, Predict, Trade)
│   │   │   │       ├── service/     # 服务层
│   │   │   │       └── ui/          # UI 层 (Screens, Components, ViewModel)
│   │   │   ├── res/                # 资源文件
│   │   │   └── AndroidManifest.xml
│   │   └── test/                   # 测试代码
│   ├── build.gradle.kts            # 应用级构建配置
│   └── proguard-rules.pro          # 混淆规则
├── gradle/                         # Gradle 包装器
├── build.gradle.kts                # 项目级构建配置
├── settings.gradle.kts             # Gradle 设置
└── gradle.properties               # Gradle 属性

```

## 🎯 功能概览

### Core Features:
- **AI 分析**: `AiPromptBuilder` - AI 驱动的市场分析
- **K 线图**: `KlineComponent` - 实时 K 线数据展示
- **风险管理**: `RiskManager` - 风险控制引擎
- **趋势预测**: `TrendPredictor` - 趋势预测算法
- **交易执行**: `TradeViewModel` - 交易订单管理
- **新闻**: `NewsFetcher` - 实时新闻推送
- **Websocket**: 实时数据流 (`KlineStreamer`, `UserDataStreamer`)

### Network Integration:
- **Binance API** - 币安交易所 API
- **DeepSeek AI** - 深度智能分析
- **News API** - 新闻数据源

### Database:
- **Room Database** - 本地数据存储
- **Entity Types**: AI Analysis, K-line, Trade, Trend Prediction, News

## 🐛 常见问题

### Q1: Gradle 构建失败
```bash
# 清理缓存
./gradlew clean

# 更新 gradle wrapper
./gradlew wrapper --gradle-version=latest

# 重新同步
./gradlew sync
```

### Q2: 依赖下载慢
在 `build.gradle.kts` 中配置镜像:
```kotlin
repositories {
    maven { url = uri("https://mirrors.aliyun.com/androidx/") }
    maven { url = uri("https://mirrors.aliyun.com/google/") }
    google()
    mavenCentral()
}
```

### Q3: 找不到 SDK
```bash
# 检查 ANDROID_HOME
echo $ANDROID_HOME

# 或在 local.properties 中指定
sdk.dir=/path/to/android/sdk
```

### Q4: App 崩溃 - 权限问题
检查 `AndroidManifest.xml` 中的权限:
- `INTERNET` - 网络访问
- `ACCESS_NETWORK_STATE` - 网络状态
- `CAMERA` - 摄像头 (如需要)
- `READ_EXTERNAL_STORAGE` - 存储读取

## 📝 API 配置

在应用初始化时配置以下 API 密钥:

```kotlin
// Binance API
ConfigStore.binanceApiKey = "your_binance_key"
ConfigStore.binanceSecretKey = "your_binance_secret"

// DeepSeek AI
ConfigStore.deepseekApiKey = "your_deepseek_key"

// News API
ConfigStore.newsApiKey = "your_news_api_key"
```

## 🚀 优化和性能

```bash
# 启用 R8 代码混淆 (Release 构建自动)
# proguard-rules.pro 配置代码保护规则

# 检查 APK 大小
./gradlew assembleDebug --profile

# 分析依赖树
./gradlew dependencies
```

## 📚 更多资源

- [Android 开发文档](https://developer.android.com/docs)
- [Kotlin 官方文档](https://kotlinlang.org/docs/)
- [Gradle 用户指南](https://docs.gradle.org/current/userguide/userguide.html)
- [Jetpack Compose](https://developer.android.com/jetpack/compose)

## 💡 Tips

1. **始终使用最新的 Android SDK** - 定期更新
2. **测试在真实设备上** - 模拟器可能与真实设备行为不同
3. **启用 Proguard/R8** - 减小 APK 大小
4. **定期清理构建缓存** - `./gradlew clean`

---

**Last Updated**: 2026-08-22
**Version**: 1.0
