#!/bin/sh
# flip-cc uninstaller script
# Safely removes flip-cc without affecting Claude Code

set -e

BINARY_NAME="flip-cc"
INSTALL_DIR="/usr/local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { printf "${BLUE}→${NC} %s\n" "$1"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; }

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "darwin";;
        *)          echo "unknown";;
    esac
}

# Get config directory based on OS
get_config_dir() {
    local os="$1"
    case "$os" in
        darwin)
            echo "$HOME/Library/Preferences/flip-cc-nodejs"
            ;;
        linux)
            if [ -n "$XDG_CONFIG_HOME" ]; then
                echo "$XDG_CONFIG_HOME/flip-cc-nodejs"
            else
                echo "$HOME/.config/flip-cc-nodejs"
            fi
            ;;
        *)
            echo ""
            ;;
    esac
}

# Find binary location
find_binary() {
    command -v "$BINARY_NAME" 2>/dev/null || echo ""
}

# Remove binary
remove_binary() {
    local binary_path="$1"

    if [ -z "$binary_path" ]; then
        # Try default locations
        if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
            binary_path="$INSTALL_DIR/$BINARY_NAME"
        elif [ -f "$HOME/.local/bin/$BINARY_NAME" ]; then
            binary_path="$HOME/.local/bin/$BINARY_NAME"
        fi
    fi

    if [ -n "$binary_path" ] && [ -f "$binary_path" ]; then
        info "Removing binary: $binary_path"
        if [ -w "$(dirname "$binary_path")" ]; then
            rm -f "$binary_path"
        else
            info "Elevated permissions required"
            if command -v sudo >/dev/null 2>&1; then
                sudo rm -f "$binary_path"
            else
                error "Cannot remove: no write permission and sudo not available"
                return 1
            fi
        fi
        success "Binary removed"
    else
        warn "Binary not found"
    fi
}

# Remove config directory
remove_config() {
    local config_dir="$1"

    if [ -n "$config_dir" ] && [ -d "$config_dir" ]; then
        info "Removing config directory: $config_dir"
        rm -rf "$config_dir"
        success "Config directory removed"
    else
        info "No config directory found"
    fi
}

# Main uninstall flow
main() {
    echo ""
    echo "🔀 flip-cc uninstaller"
    echo ""

    # Safety check - ensure we're not removing claude
    if [ "$BINARY_NAME" = "claude" ]; then
        error "Safety check failed: refusing to uninstall 'claude'"
        exit 1
    fi

    # Detect OS
    local os
    os=$(detect_os)

    if [ "$os" = "unknown" ]; then
        error "Unsupported OS: $(uname -s)"
        exit 1
    fi

    # Find installed binary
    local binary_path
    binary_path=$(find_binary)

    # Show what will be removed
    echo "The following will be removed:"
    if [ -n "$binary_path" ]; then
        echo "  • Binary: $binary_path"
    fi
    local config_dir
    config_dir=$(get_config_dir "$os")
    if [ -n "$config_dir" ] && [ -d "$config_dir" ]; then
        echo "  • Config: $config_dir"
    fi
    echo ""

    # Confirm uninstall
    printf "Proceed with uninstallation? [y/N]: "
    read -r response
    case "$response" in
        [yY][eE][sS]|[yY])
            ;;
        *)
            info "Uninstallation cancelled"
            exit 0
            ;;
    esac

    echo ""

    # Remove components
    remove_binary "$binary_path"
    remove_config "$config_dir"

    echo ""
    success "flip-cc has been uninstalled"
    echo ""
    echo "Note: Claude Code (if installed) is unaffected."
    echo "      Your Claude Code settings and MCP servers remain intact."
    echo ""
}

main "$@"
