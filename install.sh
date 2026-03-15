#!/bin/sh
# flip-cc installer script
# Supports: Linux (x64), macOS (x64, arm64)

set -e

REPO="RyderAsKing/flip-cc"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="flip-cc"

# Colors (using ANSI escape codes)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
info() {
    printf "${BLUE}→${NC} %s\n" "$1"
}

success() {
    printf "${GREEN}✓${NC} %s\n" "$1"
}

warn() {
    printf "${YELLOW}⚠${NC} %s\n" "$1"
}

error() {
    printf "${RED}✗${NC} %s\n" "$1" >&2
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "darwin";;
        *)          echo "unknown";;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo "x64";;
        arm64|aarch64)  echo "arm64";;
        *)              echo "unknown";;
    esac
}

# Get latest release version from GitHub
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/'
}

# Download binary
download_binary() {
    local version="$1"
    local os="$2"
    local arch="$3"
    local tmpdir="$4"

    local filename
    case "$os" in
        linux)
            filename="flip-cc-linux-${arch}"
            ;;
        darwin)
            filename="flip-cc-macos-${arch}"
            ;;
        *)
            error "Unsupported OS: $os"
            return 1
            ;;
    esac

    local url="https://github.com/${REPO}/releases/download/${version}/${filename}"
    local output="${tmpdir}/${BINARY_NAME}"

    info "Downloading ${filename} (${version})..."

    if ! curl -fsSL "$url" -o "$output"; then
        error "Failed to download from: $url"
        return 1
    fi

    # Check if downloaded file is HTML (error page)
    if head -1 "$output" | grep -q "<!DOCTYPE\|<html"; then
        rm "$output"
        error "Download failed - received HTML instead of binary"
        return 1
    fi

    success "Downloaded successfully"
    return 0
}

# Verify checksum if available
verify_checksum() {
    local tmpdir="$1"
    local version="$2"
    local os="$3"
    local arch="$4"

    local checksum_url="https://github.com/${REPO}/releases/download/${version}/checksums.txt"
    local checksum_file="${tmpdir}/checksums.txt"

    # Try to download checksums
    if curl -fsSL "$checksum_url" -o "$checksum_file" 2>/dev/null; then
        info "Verifying checksum..."

        local filename
        case "$os" in
            linux) filename="flip-cc-linux-${arch}" ;;
            darwin) filename="flip-cc-cc-macos-${arch}" ;;
        esac

        # Calculate and verify checksum
        local expected_checksum
        expected_checksum=$(grep "$filename" "$checksum_file" | awk '{print $1}')

        if [ -n "$expected_checksum" ]; then
            local actual_checksum
            actual_checksum=$(sha256sum "${tmpdir}/${BINARY_NAME}" 2>/dev/null | awk '{print $1}')

            if [ "$expected_checksum" = "$actual_checksum" ]; then
                success "Checksum verified"
                return 0
            else
                warn "Checksum mismatch!"
                warn "Expected: $expected_checksum"
                warn "Actual:   $actual_checksum"
                return 1
            fi
        fi
    fi

    # Checksum verification skipped (optional)
    return 0
}

# Install binary
install_binary() {
    local tmpdir="$1"
    local source="${tmpdir}/${BINARY_NAME}"
    local dest="${INSTALL_DIR}/${BINARY_NAME}"

    info "Installing to ${dest}..."

    # Check if we need sudo
    if [ -w "$INSTALL_DIR" ]; then
        mv "$source" "$dest"
        chmod +x "$dest"
    else
        info "Elevated permissions required for ${INSTALL_DIR}"
        if command -v sudo >/dev/null 2>&1; then
            sudo mv "$source" "$dest"
            sudo chmod +x "$dest"
        else
            error "Cannot install: no write permission to ${INSTALL_DIR} and sudo not available"
            error "Please run as root or install sudo"
            return 1
        fi
    fi

    success "Installed ${BINARY_NAME}"
    return 0
}

# Verify installation
verify_installation() {
    if command -v "$BINARY_NAME" >/dev/null 2>&1; then
        local installed_version
        installed_version=$($BINARY_NAME --version 2>/dev/null || echo "unknown")
        success "Installation verified: ${installed_version}"
        return 0
    else
        error "Installation verification failed - ${BINARY_NAME} not in PATH"
        return 1
    fi
}

# Main installation flow
main() {
    echo ""
    echo "🔀 flip-cc installer"
    echo ""

    # Detect platform
    local os
    local arch

    os=$(detect_os)
    arch=$(detect_arch)

    if [ "$os" = "unknown" ] || [ "$arch" = "unknown" ]; then
        error "Unsupported platform: $(uname -s) $(uname -m)"
        error "Supported platforms: Linux (x64), macOS (x64, arm64)"
        exit 1
    fi

    # Check for ARM64 on Linux (not supported yet)
    if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
        warn "Linux ARM64 is not yet supported by the pre-built binaries"
        warn "You can build from source: https://github.com/${REPO}"
        exit 1
    fi

    info "Detected platform: ${os} (${arch})"

    # Check for required tools
    if ! command -v curl >/dev/null 2>&1; then
        error "curl is required but not installed"
        exit 1
    fi

    # Get latest version
    info "Fetching latest release..."
    local version
    version=$(get_latest_version)

    if [ -z "$version" ]; then
        error "Failed to fetch latest release version"
        error "Please check your internet connection or try again later"
        exit 1
    fi

    success "Latest version: ${version}"

    # Create temp directory
    local tmpdir
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    # Download binary
    if ! download_binary "$version" "$os" "$arch" "$tmpdir"; then
        exit 1
    fi

    # Verify checksum (optional)
    verify_checksum "$tmpdir" "$version" "$os" "$arch" || true

    # Install binary
    if ! install_binary "$tmpdir"; then
        exit 1
    fi

    # Verify installation
    if ! verify_installation; then
        # Try to add to PATH instructions
        echo ""
        warn "${BINARY_NAME} may not be in your PATH"
        warn "Add the following to your shell configuration:"
        echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
        exit 1
    fi

    # Success message
    echo ""
    echo "🎉 ${BINARY_NAME} ${version} installed successfully!"
    echo ""
    echo "Quick start:"
    echo "    flip-cc setup       # Configure your API keys"
    echo "    flip-cc launch kimi # Launch Claude Code with Kimi"
    echo ""
    echo "For more information: https://github.com/${REPO}"
    echo ""
}

# Run main function
main "$@"
