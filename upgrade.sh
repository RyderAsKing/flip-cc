#!/bin/sh
# flip-cc upgrade script
# Backs up config, uninstalls old version, installs new version, restores config

set -e

BINARY_NAME="flip-cc"
INSTALL_URL="https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/install.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { printf "${BLUE}→${NC} %s\n" "$1"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; }
step() { printf "\n${CYAN}%s${NC}\n" "$1"; }

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

# Get current installed version
get_current_version() {
    if command -v "$BINARY_NAME" >/dev/null 2>&1; then
        "$BINARY_NAME" --version 2>/dev/null || echo "unknown"
    else
        echo "not installed"
    fi
}

# Backup config
backup_config() {
    local config_dir="$1"
    local backup_dir="$2"

    if [ -n "$config_dir" ] && [ -d "$config_dir" ]; then
        info "Backing up configuration..."
        mkdir -p "$backup_dir"

        # Copy entire config directory
        cp -r "$config_dir"/* "$backup_dir"/ 2>/dev/null || true

        # Verify backup
        if [ -f "$backup_dir/config.json" ]; then
            success "Configuration backed up"
            return 0
        else
            warn "Config file not found in backup, but continuing..."
            return 0
        fi
    else
        info "No existing configuration to backup"
        return 1
    fi
}

# Restore config
restore_config() {
    local config_dir="$1"
    local backup_dir="$2"

    if [ -d "$backup_dir" ]; then
        info "Restoring configuration..."

        # Ensure config directory exists
        mkdir -p "$config_dir"

        # Restore backup
        cp -r "$backup_dir"/* "$config_dir"/ 2>/dev/null || true

        # Verify restore
        if [ -f "$config_dir/config.json" ]; then
            success "Configuration restored"
        else
            warn "Could not verify config restoration"
        fi

        # Clean up backup
        rm -rf "$backup_dir"
    fi
}

# Remove old binary
remove_old_binary() {
    local binary_path
    binary_path=$(command -v "$BINARY_NAME" 2>/dev/null || echo "")

    if [ -n "$binary_path" ] && [ -f "$binary_path" ]; then
        info "Removing old binary: $binary_path"
        if [ -w "$(dirname "$binary_path")" ]; then
            rm -f "$binary_path"
        else
            if command -v sudo >/dev/null 2>&1; then
                sudo rm -f "$binary_path"
            else
                error "Cannot remove old binary: no write permission and sudo not available"
                return 1
            fi
        fi
        success "Old binary removed"
    fi
}

# Run install script
run_install() {
    info "Downloading and running latest installer..."
    if ! command -v curl >/dev/null 2>&1; then
        error "curl is required but not installed"
        return 1
    fi

    if ! curl -fsSL "$INSTALL_URL" | sh; then
        error "Installation failed"
        return 1
    fi

    return 0
}

# Main upgrade flow
main() {
    echo ""
    echo "🔀 flip-cc upgrader"
    echo ""

    # Detect OS
    local os
    os=$(detect_os)

    if [ "$os" = "unknown" ]; then
        error "Unsupported OS: $(uname -s)"
        exit 1
    fi

    # Get current version
    local current_version
    current_version=$(get_current_version)

    if [ "$current_version" = "not installed" ]; then
        warn "flip-cc is not currently installed"
        info "Running fresh installation instead..."
        run_install
        exit 0
    fi

    step "Current version: $current_version"

    # Setup paths
    local config_dir
    config_dir=$(get_config_dir "$os")
    local backup_dir
    backup_dir="$(mktemp -d)/flip-cc-backup"

    # Track if we had a backup
    local had_config=false

    # Step 1: Backup config
    if [ -n "$config_dir" ] && [ -d "$config_dir" ]; then
        if backup_config "$config_dir" "$backup_dir"; then
            had_config=true
        fi
    fi

    # Step 2: Remove old binary
    remove_old_binary

    # Step 3: Run installer
    echo ""
    if ! run_install; then
        error "Upgrade failed during installation"

        # Attempt to restore config if we had one
        if [ "$had_config" = true ]; then
            warn "Attempting to restore configuration..."
            restore_config "$config_dir" "$backup_dir"
        fi

        exit 1
    fi

    # Step 4: Restore config
    if [ "$had_config" = true ]; then
        restore_config "$config_dir" "$backup_dir"
    fi

    # Get new version
    local new_version
    new_version=$(get_current_version)

    # Success message
    echo ""
    success "flip-cc upgraded successfully!"
    echo ""
    echo "Version: $current_version → $new_version"
    echo ""

    if [ "$had_config" = true ]; then
        echo "Your API keys and configuration have been preserved."
    else
        echo "Run 'flip-cc setup' to configure your API keys."
    fi

    echo ""
}

# Handle interruption
trap 'error "Upgrade interrupted"; exit 1' INT TERM

main "$@"
