# APK Signing Setup Guide

## 🔐 Overview

This guide covers setting up automatic APK signing for the Open WebUI Client app using EAS (Expo Application Services). Proper signing is essential for:

- **Production releases** to Google Play Store
- **Internal distribution** with consistent app identity
- **App updates** that users can install over existing versions
- **Security** and authenticity verification

## 🏗️ Signing Architecture

### Build Profiles and Signing

| Profile | Purpose | Keystore | Output | Distribution |
|---------|---------|----------|--------|--------------|
| `development` | Development/Testing | Debug | APK | Internal |
| `preview` | QA/Staging | Release | APK | Internal |
| `production` | Play Store | Release | AAB | Public |
| `production-apk` | Direct Distribution | Release | APK | Public |

## 🚀 Quick Setup (Recommended)

### 1. Automatic Keystore Generation

```bash
# Login to EAS (if not already done)
eas login

# Generate and configure signing automatically
eas build --profile production --platform android

# EAS will prompt to create a new keystore - select "Yes"
# This creates and securely stores your release keystore
```

### 2. Verify Signing Setup

```bash
# Check current credentials
eas credentials --platform android

# You should see:
# ✓ Android Keystore
# ✓ Key Alias
# ✓ Keystore Password
# ✓ Key Password
```

## 🔧 Manual Keystore Setup (Advanced)

### 1. Generate Keystore Manually

```bash
# Generate a new keystore (if you don't have one)
keytool -genkey -v -keystore my-release-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias my-key-alias

# Follow prompts to set:
# - Keystore password
# - Key password  
# - Certificate details (name, organization, etc.)
```

### 2. Upload to EAS

```bash
# Configure credentials manually
eas credentials --platform android

# Select "Set up new keystore"
# Choose "Upload existing keystore"
# Provide:
# - Path to .jks file
# - Keystore password
# - Key alias
# - Key password
```

## 📋 Keystore Management

### Backup Your Keystore

**⚠️ CRITICAL: Always backup your production keystore!**

```bash
# Download keystore from EAS (backup)
eas credentials --platform android
# Select "Download credentials"
# Save the .jks file securely

# Store securely:
# - Company password manager
# - Encrypted cloud storage
# - Secure physical location
```

### Keystore Information

```bash
# View keystore details
keytool -list -v -keystore my-release-key.jks

# Check certificate fingerprints
keytool -list -v -keystore my-release-key.jks -alias my-key-alias
```

## 🔄 Signing Workflow

### Development Builds
```bash
# Uses debug keystore (automatically managed)
eas build --profile development --platform android --local
```

### Production Builds
```bash
# Uses release keystore (configured above)
eas build --profile production --platform android

# For direct APK distribution
eas build --profile production-apk --platform android
```

## 🛡️ Security Best Practices

### 1. Keystore Security
- **Never commit keystores to version control**
- **Use strong passwords** (12+ characters, mixed case, numbers, symbols)
- **Limit access** to keystore files and passwords
- **Regular backups** in multiple secure locations
- **Document keystore details** securely (password manager)

### 2. EAS Credentials
- **Use team accounts** for shared projects
- **Enable 2FA** on Expo accounts
- **Regular access reviews** for team members
- **Separate credentials** for different environments

### 3. Build Security
- **Verify build artifacts** before distribution
- **Use official build environments** (EAS cloud builds)
- **Monitor build logs** for suspicious activity
- **Sign builds immediately** after generation

## 🔍 Verification

### 1. Verify APK Signature

```bash
# Check APK signature
jarsigner -verify -verbose -certs your-app.apk

# Should show:
# - jar verified
# - Certificate details
# - Signature algorithm
```

### 2. APK Analyzer (Android Studio)

1. Open Android Studio
2. Go to **Build** → **Analyze APK**
3. Select your APK file
4. Check **META-INF** folder for certificates

### 3. Play Console Verification

1. Upload AAB to Play Console
2. Check **Release** → **App signing**
3. Verify certificate fingerprints match

## 🚨 Troubleshooting

### Common Signing Issues

#### 1. Keystore Not Found
```
Error: Could not find keystore
```

**Solution:**
```bash
# Re-upload keystore
eas credentials --platform android
# Select "Set up new keystore" → "Upload existing keystore"
```

#### 2. Wrong Key Alias
```
Error: Key alias not found in keystore
```

**Solution:**
```bash
# List aliases in keystore
keytool -list -keystore my-release-key.jks

# Update alias in EAS credentials
eas credentials --platform android
```

#### 3. Password Mismatch
```
Error: Keystore password incorrect
```

**Solution:**
```bash
# Reset credentials with correct password
eas credentials --platform android
# Select "Remove all credentials" then re-setup
```

#### 4. Certificate Expired
```
Error: Certificate has expired
```

**Solution:**
```bash
# Generate new keystore (will require new app listing)
# Or extend existing certificate if possible
keytool -selfcert -alias my-key-alias -keystore my-release-key.jks
```

### Build Signing Failures

#### 1. Clean and Retry
```bash
# Clear EAS cache
eas build:cancel  # if build is running
eas build --profile production --platform android --clear-cache
```

#### 2. Local vs Cloud Builds
```bash
# If local build fails, try cloud build
eas build --profile production --platform android

# If cloud build fails, try local build
eas build --profile production --platform android --local
```

## 📊 Monitoring and Maintenance

### 1. Certificate Expiry Tracking

```bash
# Check certificate validity
keytool -list -v -keystore my-release-key.jks -alias my-key-alias | grep "Valid"

# Set calendar reminders for:
# - 1 year before expiry
# - 6 months before expiry
# - 3 months before expiry
```

### 2. Regular Verification

**Monthly Checks:**
- [ ] Verify keystore accessibility
- [ ] Test signing process
- [ ] Backup verification
- [ ] Team access review

**Quarterly Checks:**
- [ ] Certificate expiry dates
- [ ] Security audit
- [ ] Process documentation update
- [ ] Disaster recovery test

## 🔄 Team Workflow

### 1. Developer Setup
```bash
# Each developer needs:
eas login  # with team account access

# Verify access
eas credentials --platform android
# Should show team keystores
```

### 2. Release Process
```bash
# 1. Create release branch
git checkout -b release/v1.0.0

# 2. Update version numbers
# Edit app.json version field

# 3. Build production APK/AAB
eas build --profile production --platform android

# 4. Test signed build
# Install and verify on test devices

# 5. Distribute
# Upload to Play Store or distribute APK
```

### 3. Emergency Procedures

**If keystore is lost:**
1. **Stop all releases immediately**
2. **Generate new keystore**
3. **Update app package name** (if needed)
4. **Create new Play Store listing** (if required)
5. **Notify users** about app reinstallation

**If credentials are compromised:**
1. **Revoke access immediately**
2. **Generate new keystore**
3. **Update all team credentials**
4. **Audit recent builds**
5. **Review security procedures**

## 📚 Additional Resources

### Documentation
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)
- [Play Console Help](https://support.google.com/googleplay/android-developer/)

### Tools
- **Android Studio** - APK analysis
- **jarsigner** - Signature verification
- **keytool** - Keystore management
- **EAS CLI** - Build and credential management

---

**⚠️ Important Notes:**
- Always test signed builds before distribution
- Keep multiple backups of production keystores
- Document all keystore details securely
- Regular security audits of signing process
- Train team members on proper procedures

**Last Updated**: $(date)
**Maintained by**: Development Team