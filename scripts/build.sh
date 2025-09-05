#!/bin/bash

# Open WebUI Client - Build Script
# This script automates the build process with proper environment setup

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # Check EAS CLI
    if ! command -v eas &> /dev/null; then
        print_error "EAS CLI is not installed. Run: npm install -g @expo/eas-cli"
        exit 1
    fi
    
    # Check Expo CLI
    if ! command -v expo &> /dev/null; then
        print_error "Expo CLI is not installed. Run: npm install -g @expo/cli"
        exit 1
    fi
    
    print_success "All prerequisites are installed"
}

# Function to setup Android environment
setup_android_env() {
    print_status "Setting up Android environment..."
    
    # Detect OS and set Android SDK path
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        ANDROID_SDK_PATH="$HOME/Library/Android/sdk"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        ANDROID_SDK_PATH="$HOME/Android/Sdk"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        # Windows
        ANDROID_SDK_PATH="$LOCALAPPDATA/Android/Sdk"
    else
        print_warning "Unknown OS type. Please set ANDROID_HOME manually."
        return
    fi
    
    # Check if Android SDK exists
    if [ ! -d "$ANDROID_SDK_PATH" ]; then
        print_error "Android SDK not found at $ANDROID_SDK_PATH"
        print_error "Please install Android Studio and SDK"
        exit 1
    fi
    
    # Set environment variables
    export ANDROID_HOME="$ANDROID_SDK_PATH"
    export ANDROID_SDK_ROOT="$ANDROID_SDK_PATH"
    export PATH="$PATH:$ANDROID_HOME/emulator"
    export PATH="$PATH:$ANDROID_HOME/platform-tools"
    export PATH="$PATH:$ANDROID_HOME/tools"
    
    print_success "Android environment configured"
    print_status "ANDROID_HOME: $ANDROID_HOME"
    
    # Verify ADB
    if command -v adb &> /dev/null; then
        print_success "ADB is available"
    else
        print_warning "ADB not found in PATH"
    fi
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
}

# Function to build the app
build_app() {
    local profile=$1
    local platform=${2:-android}
    local local_build=${3:-false}
    
    print_status "Building app with profile: $profile, platform: $platform"
    
    # Build command
    local build_cmd="eas build --profile $profile --platform $platform"
    
    if [ "$local_build" = true ]; then
        build_cmd="$build_cmd --local"
        print_status "Building locally..."
    else
        print_status "Building on EAS cloud..."
    fi
    
    # Execute build
    if eval $build_cmd; then
        print_success "Build completed successfully!"
        
        # If local build, show APK location
        if [ "$local_build" = true ]; then
            print_status "Looking for generated APK..."
            find . -name "*.apk" -type f -newer /tmp/build_start_time 2>/dev/null | head -5
        fi
    else
        print_error "Build failed!"
        exit 1
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -p, --profile PROFILE    Build profile (development, preview, production, production-apk)"
    echo "  -l, --local             Build locally instead of on EAS cloud"
    echo "  -c, --clean             Clean cache before building"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -p development -l     # Local development build"
    echo "  $0 -p production         # Cloud production build"
    echo "  $0 -p preview -l -c      # Local preview build with cache clean"
}

# Function to clean cache
clean_cache() {
    print_status "Cleaning cache..."
    
    # Clean Expo cache
    if command -v expo &> /dev/null; then
        expo r -c
    fi
    
    # Clean npm cache
    npm cache clean --force
    
    # Clean node_modules if exists
    if [ -d "node_modules" ]; then
        print_status "Removing node_modules..."
        rm -rf node_modules
        npm install
    fi
    
    print_success "Cache cleaned"
}

# Main function
main() {
    # Create timestamp file for finding new APKs
    touch /tmp/build_start_time
    
    # Default values
    PROFILE="development"
    LOCAL_BUILD=false
    CLEAN_CACHE=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--profile)
                PROFILE="$2"
                shift 2
                ;;
            -l|--local)
                LOCAL_BUILD=true
                shift
                ;;
            -c|--clean)
                CLEAN_CACHE=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Validate profile
    case $PROFILE in
        development|preview|production|production-apk)
            ;;
        *)
            print_error "Invalid profile: $PROFILE"
            print_error "Valid profiles: development, preview, production, production-apk"
            exit 1
            ;;
    esac
    
    print_status "Starting build process..."
    print_status "Profile: $PROFILE"
    print_status "Local build: $LOCAL_BUILD"
    print_status "Clean cache: $CLEAN_CACHE"
    
    # Execute build steps
    check_prerequisites
    
    if [ "$CLEAN_CACHE" = true ]; then
        clean_cache
    fi
    
    setup_android_env
    install_dependencies
    build_app "$PROFILE" "android" "$LOCAL_BUILD"
    
    print_success "Build process completed!"
    
    # Cleanup
    rm -f /tmp/build_start_time
}

# Run main function with all arguments
main "$@"