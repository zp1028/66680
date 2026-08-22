# Quant App APK 打包指南

## 快速开始

### 前置要求
1. **Java Development Kit (JDK) 11+** - [下载](https://www.oracle.com/java/technologies/downloads/)
2. **Android SDK** - 通过 Android Studio 安装
3. **Gradle** - 项目已包含 Gradle Wrapper

### 方法 1: 使用 Gradle 命令行打包

#### 步骤 1: 解压项目
```bash
unzip quant-app-fixed.zip
cd quant-app
```

#### 步骤 2: 构建 Release APK
```bash
# 方式 A: 使用 Gradle Wrapper (推荐)
./gradlew assembleRelease

# 方式 B: 如果在 Windows
gradlew.bat assembleRelease

# 方式 C: 如果本地已安装 Gradle
gradle assembleRelease
```

#### 步骤 3: 签名 APK (生产环境必需)
如果上述命令生成的 APK 未签名，需要手动签名：

```bash
# 生成签名密钥 (首次)
keytool -genkey -v -keystore quant-app.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias quant-app

# 签名 APK
jarsigner -verbose -sigalg MD5withRSA -digestalg SHA1 \
  -keystore quant-app.keystore \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  quant-app

# 优化 APK (可选)
zipalign -v 4 app/build/outputs/apk/release/app-release-unsigned.apk \
  app/build/outputs/apk/release/app-release-final.apk
```

#### 步骤 4: 输出文件位置
```
app/build/outputs/apk/release/app-release.apk
```

---

### 方法 2: 使用 Android Studio 打包

1. 打开 Android Studio
2. File → Open → 选择解压的 `quant-app` 目录
3. 等待 Gradle 同步完成
4. Build → Build Bundle(s) / APK(s) → Build APK(s)
5. 输出路径会在右下角显示

---

### 方法 3: Debug APK (快速测试)

```bash
./gradlew assembleDebug
# 输出: app/build/outputs/apk/debug/app-debug.apk
```

---

## APK 文件安装

### 安装到真机或模拟器
```bash
# 需要先启动 ADB (Android Debug Bridge)
adb install -r app/build/outputs/apk/release/app-release.apk

# -r 表示覆盖安装
```

### 或者直接拖拽安装
- 将 APK 文件复制到 Android 设备
- 打开文件管理器，点击 APK 文件选择安装

---

## 常见问题排查

### 问题 1: 找不到 Java
```bash
# 检查 Java 版本
java -version

# 设置 JAVA_HOME (如需要)
# Windows: set JAVA_HOME=C:\Program Files\Java\jdk-11
# Linux/Mac: export JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-11.jdk/Contents/Home
```

### 问题 2: 构建失败 - 依赖下载问题
```bash
# 清除缓存后重试
./gradlew clean
./gradlew assembleRelease --refresh-dependencies
```

### 问题 3: SDK 版本不匹配
修改 `app/build.gradle.kts`:
```kotlin
android {
    compileSdk = 34  // 修改为你的 SDK 版本
    defaultConfig {
        minSdk = 24
        targetSdk = 34
    }
}
```

---

## 详细构建配置

### 查看 build.gradle.kts
项目的主要构建配置位于:
- `build.gradle.kts` - 根项目配置
- `app/build.gradle.kts` - app 模块配置
- `gradle/libs.versions.toml` - 依赖版本管理

### 自定义输出目录
在 `app/build.gradle.kts` 中添加:
```kotlin
android {
    buildTypes {
        release {
            applicationIdSuffix = ".release"
            versionNameSuffix = "-release"
        }
    }
    
    packagingOptions {
        resources {
            excludes += "META-INF/**"
        }
    }
}
```

---

## 发布到应用商店

### 生成 AAB (Android App Bundle) - 推荐用于 Google Play
```bash
./gradlew bundleRelease
# 输出: app/build/outputs/bundle/release/app-release.aab
```

### App Bundle 签名
```bash
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore quant-app.keystore \
  app/build/outputs/bundle/release/app-release.aab \
  quant-app
```

---

## 性能优化建议

1. **启用 ProGuard/R8 混淆** (Release 构建)
   ```kotlin
   release {
       minifyEnabled true
       shrinkResources true
       proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
   }
   ```

2. **分离 APK** (多架构支持)
   ```kotlin
   splits {
       abi {
           enable true
           reset()
           include 'armeabi-v7a', 'arm64-v8a'
           universalApk true
       }
   }
   ```

3. **检查 APK 大小**
   ```bash
   ./gradlew analyzeReleaseBundle
   ```

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `build.gradle.kts` | 根项目构建脚本 |
| `app/build.gradle.kts` | App 模块构建脚本 |
| `gradle/libs.versions.toml` | 依赖版本管理 |
| `settings.gradle.kts` | 项目设置 |
| `gradle.properties` | Gradle 配置属性 |
| `.github/workflows/build.yml` | CI/CD 工作流 (如配置) |

---

## 使用 CI/CD 自动打包

如果项目配置了 GitHub Actions (`.github/workflows/build.yml`):
1. 推送代码到 GitHub
2. GitHub Actions 自动触发构建
3. 在 Actions 标签页下载构建产物

---

## 支持的命令汇总

```bash
# 清理
./gradlew clean

# 构建
./gradlew build                    # 完整构建
./gradlew assembleRelease          # Release APK
./gradlew assembleDebug            # Debug APK
./gradlew bundleRelease            # App Bundle

# 测试
./gradlew test                     # 单元测试
./gradlew connectedAndroidTest     # 集成测试

# 检查
./gradlew lint                     # 代码检查
./gradlew dependencies             # 查看依赖

# 缓存
./gradlew --refresh-dependencies   # 刷新依赖
```

---

**备注**: 如需商业发布，建议创建专业签名证书并妥善保管密钥文件。
