#!/bin/bash

# Open WebUI Client - Development Setup Script
# This script helps new team members set up their development environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}"
    echo "=================================================="
    echo "  Open WebUI Client - Development Setup"
    echo "=================================================="
    echo -e "${NC}"
}

# Check if running on supported OS
check_os() {
    print_status "Checking operating system..."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        print_success "macOS detected"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        print_success "Linux detected"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
        print_success "Windows detected"
    else
        print_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
}

# Check and install Node.js
setup_nodejs() {
    print_status "Checking Node.js installation..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js is installed: $NODE_VERSION"
        
        # Check if version is 18 or higher
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [ "$NODE_MAJOR" -lt 18 ]; then
            print_warning "Node.js version is below 18. Please upgrade to Node.js 18 or higher."
        fi
    else
        print_error "Node.js is not installed"
        print_status "Please install Node.js 18 or higher from https://nodejs.org/"
        
        if [[ "$OS" == "macos" ]]; then
            print_status "You can also install via Homebrew: brew install node"
        elif [[ "$OS" == "linux" ]]; then
            print_status "You can also install via package manager or nvm"
        fi
        
        exit 1
    fi
}

# Install global packages
install_global_packages() {
    print_status "Installing global packages..."
    
    # Check and install EAS CLI
    if ! command -v eas &> /dev/null; then
        print_status "Installing EAS CLI..."
        npm install -g @expo/eas-cli
        print_success "EAS CLI installed"
    else
        print_success "EAS CLI is already installed"
    fi
    
    # Check and install Expo CLI
    if ! command -v expo &> /dev/null; then
        print_status "Installing Expo CLI..."
        npm install -g @expo/cli
        print_success "Expo CLI installed"
    else
        print_success "Expo CLI is already installed"
    fi
}

# Setup Android development environment
setup_android() {
    print_status "Checking Android development environment..."
    
    # Detect Android SDK path
    if [[ "$OS" == "macos" ]]; then
        ANDROID_SDK_PATH="$HOME/Library/Android/sdk"
    elif [[ "$OS" == "linux" ]]; then
        ANDROID_SDK_PATH="$HOME/Android/Sdk"
    elif [[ "$OS" == "windows" ]]; then
        ANDROID_SDK_PATH="$LOCALAPPDATA/Android/Sdk"
    fi
    
    if [ -d "$ANDROID_SDK_PATH" ]; then
        print_success "Android SDK found at: $ANDROID_SDK_PATH"
        
        # Add to shell profile
        SHELL_PROFILE=""
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_PROFILE="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_PROFILE="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_PROFILE="$HOME/.bash_profile"
        fi
        
        if [ -n "$SHELL_PROFILE" ]; then
            # Check if Android environment is already configured
            if ! grep -q "ANDROID_HOME" "$SHELL_PROFILE"; then
                print_status "Adding Android environment variables to $SHELL_PROFILE"
                echo "" >> "$SHELL_PROFILE"
                echo "# Android SDK" >> "$SHELL_PROFILE"
                echo "export ANDROID_HOME=\"$ANDROID_SDK_PATH\"" >> "$SHELL_PROFILE"
                echo "export ANDROID_SDK_ROOT=\"$ANDROID_SDK_PATH\"" >> "$SHELL_PROFILE"
                echo "export PATH=\"\$PATH:\$ANDROID_HOME/emulator\"" >> "$SHELL_PROFILE"
                echo "export PATH=\"\$PATH:\$ANDROID_HOME/platform-tools\"" >> "$SHELL_PROFILE"
                echo "export PATH=\"\$PATH:\$ANDROID_HOME/tools\"" >> "$SHELL_PROFILE"
                print_success "Android environment variables added to $SHELL_PROFILE"
                print_warning "Please restart your terminal or run: source $SHELL_PROFILE"
            else
                print_success "Android environment variables already configured"
            fi
        fi
        
        # Set for current session
        export ANDROID_HOME="$ANDROID_SDK_PATH"
        export ANDROID_SDK_ROOT="$ANDROID_SDK_PATH"
        export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools"
        
    else
        print_error "Android SDK not found at $ANDROID_SDK_PATH"
        print_status "Please install Android Studio and SDK from https://developer.android.com/studio"
        print_warning "After installation, run this script again"
    fi
    
    # Check ADB
    if command -v adb &> /dev/null; then
        print_success "ADB is available"
    else
        print_warning "ADB not found. Make sure Android SDK platform-tools are installed"
    fi
}

# Install project dependencies
install_dependencies() {
    print_status "Installing project dependencies..."
    
    if [ -f "package.json" ]; then
        npm install
        print_success "Project dependencies installed"
    else
        print_error "package.json not found. Are you in the project directory?"
        exit 1
    fi
}

# Setup EAS authentication
setup_eas_auth() {
    print_status "Setting up EAS authentication..."
    
    print_status "Please log in to your Expo account:"
    if eas login; then
        print_success "EAS authentication successful"
    else
        print_error "EAS authentication failed"
        print_status "Please create an account at https://expo.dev/ if you don't have one"
    fi
}

# Verify setup
verify_setup() {
    print_status "Verifying setup..."
    
    local errors=0
    
    # Check Node.js
    if command -v node &> /dev/null; then
        print_success "✓ Node.js: $(node --version)"
    else
        print_error "✗ Node.js not found"
        errors=$((errors + 1))
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        print_success "✓ npm: $(npm --version)"
    else
        print_error "✗ npm not found"
        errors=$((errors + 1))
    fi
    
    # Check EAS CLI
    if command -v eas &> /dev/null; then
        print_success "✓ EAS CLI: $(eas --version)"
    else
        print_error "✗ EAS CLI not found"
        errors=$((errors + 1))
    fi
    
    # Check Expo CLI
    if command -v expo &> /dev/null; then
        print_success "✓ Expo CLI: $(expo --version)"
    else
        print_error "✗ Expo CLI not found"
        errors=$((errors + 1))
    fi
    
    # Check Android SDK
    if [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME" ]; then
        print_success "✓ Android SDK: $ANDROID_HOME"
    else
        print_error "✗ Android SDK not configured"
        errors=$((errors + 1))
    fi
    
    # Check ADB
    if command -v adb &> /dev/null; then
        print_success "✓ ADB: $(adb --version | head -n1)"
    else
        print_warning "⚠ ADB not found (optional but recommended)"
    fi
    
    if [ $errors -eq 0 ]; then
        print_success "All checks passed! Your development environment is ready."
    else
        print_error "$errors error(s) found. Please fix the issues above."
        return 1
    fi
}

# Show next steps
show_next_steps() {
    echo -e "${GREEN}"
    echo "=================================================="
    echo "  Setup Complete! Next Steps:"
    echo "=================================================="
    echo -e "${NC}"
    echo "1. Test your setup:"
    echo "   npm run build:dev"
    echo ""
    echo "2. Start development server:"
    echo "   npm start"
    echo ""
    echo "3. Build for different profiles:"
    echo "   npm run build:dev        # Local development build"
    echo "   npm run build:preview    # Local preview build"
    echo "   npm run build:prod       # Cloud production build"
    echo ""
    echo "4. Manage credentials:"
    echo "   npm run credentials:android"
    echo ""
    echo "5. Read the documentation:"
    echo "   - BUILD_GUIDE.md"
    echo "   - SIGNING_SETUP.md"
    echo ""
    echo "Happy coding! 🚀"
}

# Main function
main() {
    print_header
    
    check_os
    setup_nodejs
    install_global_packages
    setup_android
    install_dependencies
    setup_eas_auth
    
    if verify_setup; then
        show_next_steps
    else
        print_error "Setup incomplete. Please fix the issues and run the script again."
        exit 1
    fi
}

# Run main function
main "$@"