# Open WebUI Client - Build Guide

## 📋 Table of Contents
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Build Configurations](#build-configurations)
- [APK Signing Setup](#apk-signing-setup)
- [Building the App](#building-the-app)
- [Troubleshooting](#troubleshooting)
- [Distribution](#distribution)

## 🔧 Prerequisites

### Required Software
- **Node.js** (v18 or later)
- **npm** or **yarn**
- **Android Studio** with Android SDK
- **EAS CLI**: `npm install -g @expo/eas-cli`
- **Expo CLI**: `npm install -g @expo/cli`

### Android SDK Requirements
- **Build Tools**: 35.0.0
- **Target SDK**: 35
- **Min SDK**: 24
- **NDK**: 27.1.12297006

## 🌍 Environment Setup

### 1. Android SDK Configuration

**macOS/Linux:**
```bash
# Add to ~/.zshrc or ~/.bashrc
export ANDROID_HOME=~/Library/Android/sdk
export ANDROID_SDK_ROOT=~/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
```

**Windows:**
```cmd
# Add to system environment variables
ANDROID_HOME=C:\Users\%USERNAME%\AppData\Local\Android\Sdk
ANDROID_SDK_ROOT=C:\Users\%USERNAME%\AppData\Local\Android\Sdk
```

### 2. Verify Installation
```bash
# Check Android SDK
adb version
# Check EAS CLI
eas --version
# Check Expo CLI
expo --version
```

### 3. Project Setup
```bash
# Clone and install dependencies
git clone <repository-url>
cd Open-WebUI-Client
npm install

# Login to Expo (required for builds)
eas login
```

## 🏗️ Build Configurations

Our project supports multiple build profiles defined in `eas.json`:

### Development Build
- **Purpose**: Testing with Expo Dev Client
- **Features**: Hot reload, debugging tools, development server
- **Output**: APK file (~200MB)
- **Signing**: Debug keystore

### Preview Build
- **Purpose**: Internal testing and QA
- **Features**: Production-like but with internal distribution
- **Output**: APK file
- **Signing**: Release keystore

### Production Build
- **Purpose**: Google Play Store distribution
- **Features**: Optimized, minified, production-ready
- **Output**: AAB (Android App Bundle) file
- **Signing**: Release keystore

### Production APK Build
- **Purpose**: Direct APK distribution (sideloading)
- **Features**: Same as production but APK format
- **Output**: APK file
- **Signing**: Release keystore

## 🔐 APK Signing Setup

### Automatic Signing (Recommended)

EAS automatically manages your signing credentials. To set up:

1. **Generate credentials automatically:**
```bash
eas credentials
```

2. **Select platform and follow prompts:**
   - Choose "Android"
   - Select "Set up new keystore"
   - EAS will generate and store your keystore securely

### Manual Signing (Advanced)

If you have an existing keystore:

1. **Upload existing keystore:**
```bash
eas credentials
# Select "Use existing keystore"
# Upload your .jks file
```

2. **Configure keystore details:**
   - Keystore password
   - Key alias
   - Key password

### Keystore Management

**View current credentials:**
```bash
eas credentials --platform android
```

**Download keystore (backup):**
```bash
eas credentials --platform android
# Select "Download credentials"
```

## 🚀 Building the App

### Local Builds

**Development Build:**
```bash
# Set environment variables first
export ANDROID_HOME=~/Library/Android/sdk
export ANDROID_SDK_ROOT=~/Library/Android/sdk

# Build locally
eas build --profile development --platform android --local
```

**Preview Build:**
```bash
eas build --profile preview --platform android --local
```

**Production APK Build:**
```bash
eas build --profile production-apk --platform android --local
```

### Cloud Builds (Recommended for Production)

**Development Build:**
```bash
eas build --profile development --platform android
```

**Preview Build:**
```bash
eas build --profile preview --platform android
```

**Production Build (AAB for Play Store):**
```bash
eas build --profile production --platform android
```

**Production APK Build:**
```bash
eas build --profile production-apk --platform android
```

### Build Status and Downloads

**Check build status:**
```bash
eas build:list
```

**Download completed builds:**
```bash
eas build:download [BUILD_ID]
```

## 🐛 Troubleshooting

### Common Issues

#### 1. SDK Location Not Found
**Error:** `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable`

**Solution:**
```bash
# Verify Android SDK path
ls ~/Library/Android/sdk  # macOS
ls %LOCALAPPDATA%\Android\Sdk  # Windows

# Set environment variables
export ANDROID_HOME=~/Library/Android/sdk
export ANDROID_SDK_ROOT=~/Library/Android/sdk
```

#### 2. Build Tools Version Mismatch
**Error:** Build tools version not found

**Solution:**
```bash
# Install required build tools via Android Studio SDK Manager
# Or via command line:
sdkmanager "build-tools;35.0.0"
```

#### 3. NDK Not Found
**Error:** NDK not found

**Solution:**
```bash
# Install NDK via Android Studio or:
sdkmanager "ndk;27.1.12297006"
```

#### 4. Memory Issues During Build
**Error:** Out of memory during build

**Solution:**
```bash
# Increase heap size
export GRADLE_OPTS="-Xmx4g -XX:MaxMetaspaceSize=512m"
```

#### 5. Keystore Issues
**Error:** Keystore problems during signing

**Solution:**
```bash
# Reset credentials and generate new ones
eas credentials --platform android
# Select "Remove all credentials" then "Set up new keystore"
```

### Build Optimization Tips

1. **Clean builds when needed:**
```bash
# Clear Expo cache
expo r -c
# Clear npm cache
npm cache clean --force
```

2. **Use cloud builds for production:**
   - More reliable
   - Consistent environment
   - Better for CI/CD

3. **Monitor build times:**
   - Local builds: ~10-15 minutes
   - Cloud builds: ~15-25 minutes

## 📦 Distribution

### Development Distribution
- Share APK files directly with team members
- Use internal testing channels
- Install via ADB or file transfer

### Production Distribution

#### Google Play Store (AAB)
```bash
# Build AAB
eas build --profile production --platform android

# Submit to Play Store
eas submit --platform android
```

#### Direct APK Distribution
```bash
# Build production APK
eas build --profile production-apk --platform android

# Distribute via:
# - Direct download links
# - Internal app stores
# - Email/cloud storage
```

### Installation Instructions for End Users

#### APK Installation
1. Download APK file to Android device
2. Enable "Install from unknown sources" in Settings
3. Open file manager and tap APK file
4. Follow installation prompts

#### ADB Installation (Developers)
```bash
# Connect device via USB with USB debugging enabled
adb install path/to/your-app.apk

# Install over existing app
adb install -r path/to/your-app.apk
```

## 🔄 CI/CD Integration

### GitHub Actions Example
```yaml
name: Build Android APK
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npx eas-cli build --platform android --non-interactive
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

## 📝 Build Checklist

### Before Building
- [ ] Environment variables set correctly
- [ ] Dependencies installed (`npm install`)
- [ ] EAS CLI authenticated (`eas login`)
- [ ] Android SDK and build tools installed
- [ ] Keystore configured (for production builds)

### After Building
- [ ] APK/AAB file generated successfully
- [ ] File size reasonable (dev: ~200MB, prod: ~50-100MB)
- [ ] Test installation on physical device
- [ ] Verify app functionality
- [ ] Document build artifacts location

## 🆘 Support

### Getting Help
- **Expo Documentation**: https://docs.expo.dev/
- **EAS Build Docs**: https://docs.expo.dev/build/introduction/
- **Android Developer Docs**: https://developer.android.com/

### Team Contacts
- **Build Issues**: Contact development team
- **Signing Issues**: Contact DevOps/Release team
- **Distribution Issues**: Contact product team

---

**Last Updated**: $(date)
**Version**: 1.0.0