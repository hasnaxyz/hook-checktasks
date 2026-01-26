#!/bin/bash

# Claude Code Hook Installer: check-tasks
# Prevents Claude from stopping when there are pending tasks

set -e

HOOK_NAME="check-tasks"
HOOK_FILE="check-tasks.ts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Installing Claude Code hook: $HOOK_NAME"
echo ""

# Detect installation mode
if [[ "$1" == "--global" ]] || [[ "$1" == "-g" ]]; then
    INSTALL_MODE="global"
    TARGET_DIR="$HOME/.claude/hooks"
    SETTINGS_FILE="$HOME/.claude/settings.json"
    COMMAND_PATH="\$HOME/.claude/hooks/$HOOK_FILE"
elif [[ -n "$1" ]] && [[ "$1" != "--help" ]] && [[ "$1" != "-h" ]]; then
    INSTALL_MODE="project"
    TARGET_DIR="$1/.claude/hooks"
    SETTINGS_FILE="$1/.claude/settings.json"
    COMMAND_PATH="\"\$CLAUDE_PROJECT_DIR/.claude/hooks/$HOOK_FILE\""
else
    echo "Usage: ./install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --global, -g     Install globally to ~/.claude/hooks/"
    echo "  <project-path>   Install to a specific project"
    echo ""
    echo "Examples:"
    echo "  ./install.sh --global                    # Install globally"
    echo "  ./install.sh ~/projects/my-app          # Install to project"
    echo "  ./install.sh .                          # Install to current directory"
    exit 0
fi

echo -e "Installation mode: ${GREEN}$INSTALL_MODE${NC}"
echo -e "Target directory: ${YELLOW}$TARGET_DIR${NC}"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Copy hook file
cp "$SCRIPT_DIR/$HOOK_FILE" "$TARGET_DIR/$HOOK_FILE"
chmod +x "$TARGET_DIR/$HOOK_FILE"
echo -e "${GREEN}✓${NC} Copied $HOOK_FILE to $TARGET_DIR/"

# Create or update settings.json
if [[ -f "$SETTINGS_FILE" ]]; then
    # Check if hook already exists
    if grep -q "$HOOK_FILE" "$SETTINGS_FILE" 2>/dev/null; then
        echo -e "${YELLOW}!${NC} Hook already configured in settings.json"
    else
        # Use jq if available, otherwise provide manual instructions
        if command -v jq &> /dev/null; then
            # Create backup
            cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak"

            # Add hook to existing settings
            HOOK_CONFIG="{\"type\":\"command\",\"command\":\"bun $COMMAND_PATH\",\"timeout\":120}"

            # Check if hooks.Stop exists
            if jq -e '.hooks.Stop' "$SETTINGS_FILE" > /dev/null 2>&1; then
                # Add to existing Stop hooks
                jq ".hooks.Stop[0].hooks += [$HOOK_CONFIG]" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            else
                # Create Stop hooks section
                jq ".hooks = (.hooks // {}) | .hooks.Stop = [{\"hooks\": [$HOOK_CONFIG]}]" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            fi
            echo -e "${GREEN}✓${NC} Updated settings.json with hook configuration"
        else
            echo -e "${YELLOW}!${NC} jq not installed. Please add the hook manually to $SETTINGS_FILE"
            echo ""
            echo "Add this to your settings.json:"
            echo ""
            cat << EOF
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun $COMMAND_PATH",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
EOF
        fi
    fi
else
    # Create new settings.json
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    cat > "$SETTINGS_FILE" << EOF
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun $COMMAND_PATH",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
EOF
    echo -e "${GREEN}✓${NC} Created settings.json with hook configuration"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Configuration (optional environment variables):"
echo "  CLAUDE_CODE_TASK_LIST_ID  - Task list to monitor (required)"
echo "  CHECK_TASKS_KEYWORDS      - Keywords to trigger check (default: 'dev')"
echo "  CHECK_TASKS_DISABLED      - Set to '1' to disable the hook"
echo ""
echo "The hook will block Claude from stopping when there are pending tasks"
echo "in sessions with 'dev' in the name."
