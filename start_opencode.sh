#!/bin/bash
# OpenCode CLI Test Script
# Tests the OpenCode CLI installation and configuration

set -e

echo "🔍 Testing OpenCode CLI Installation..."
echo "======================================="

# Check for opencode
if command -v opencode &> /dev/null; then
    VERSION=$(opencode --version 2>/dev/null || echo "unknown")
    echo "✅ OpenCode CLI installed: v$VERSION"
else
    echo "❌ OpenCode CLI not found."
    echo "   Install with: npm install -g opencode-ai"
    echo "   Or: curl -fsSL https://opencode.ai/install | bash"
    exit 1
fi

# Check for API key
echo ""
echo "🔑 Checking API Keys..."
if [ -n "$OPENAI_API_KEY" ]; then
    echo "✅ OPENAI_API_KEY is set"
else
    echo "⚠️ OPENAI_API_KEY not set. Required for OpenCode to work."
    echo "   Run: export OPENAI_API_KEY=sk-your-key-here"
fi

# Check environment variables
echo ""
echo "⚙️ Checking Environment Configuration..."
if [ -n "$OPENCODE_ENABLED" ] && [ "$OPENCODE_ENABLED" = "true" ]; then
    echo "✅ OPENCODE_ENABLED=true"
else
    echo "⚠️ OPENCODE_ENABLED not set or false"
    echo "   Add to .env: OPENCODE_ENABLED=true"
fi

if [ -n "$OPENCODE_ALLOWED_FOLDERS" ]; then
    echo "✅ OPENCODE_ALLOWED_FOLDERS=${OPENCODE_ALLOWED_FOLDERS:0:50}..."
else
    echo "⚠️ OPENCODE_ALLOWED_FOLDERS not set (all paths allowed)"
    echo "   For security, set: OPENCODE_ALLOWED_FOLDERS=/Users/$USER/Documents,/Users/$USER/Downloads"
fi

# Test CLI execution with a simple prompt
echo ""
echo "🧪 Testing CLI Execution..."
echo "Running: opencode run \"What is 2 + 2? Reply with just the number.\""
echo "---"

# Note: This requires OPENAI_API_KEY to be set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️ Skipping test - OPENAI_API_KEY not set"
else
    # Run with 60 second timeout (compatible with macOS)
    if perl -e 'alarm 60; exec @ARGV' opencode run "What is 2 + 2? Reply with just the number." 2>&1; then
        echo "---"
        echo "✅ OpenCode CLI is working!"
    else
        EXIT_CODE=$?
        echo "---"
        if [ $EXIT_CODE -eq 142 ]; then
            echo "⚠️ Command timed out after 60 seconds"
        else
            echo "❌ OpenCode CLI test failed (exit code: $EXIT_CODE)"
        fi
        echo ""
        echo "Troubleshooting:"
        echo "1. Make sure OPENAI_API_KEY is set correctly"
        echo "2. Try running manually: opencode run \"Hello\""
    fi
fi

echo ""
echo "======================================="
echo "📝 Usage from Velora/Solosway:"
echo ""
echo "  User: 'Organize my downloads folder by file type'"
echo "  → The AI will detect this as a desktop action"
echo "  → Execute: opencode run \"Organize ~/Downloads by type\""
echo "  → Stream results back to the UI"
echo ""
