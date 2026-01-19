# OpenCode Integration Setup Guide

This guide explains how to set up OpenCode desktop automation integration with your Velora/Solosway application.

## Overview

OpenCode enables AI-powered desktop automation capabilities:
- **File Management**: Organize, sort, rename, and move files
- **Document Creation**: Create, summarize, and rewrite documents
- **Browser Automation**: Research, fill forms, and take screenshots

## Execution Mode: Direct CLI

The integration uses **direct CLI execution** - no separate server needed!

When you ask something like "organize my downloads folder", the system:
1. Detects it's a desktop automation request
2. Executes `npx @opencode/cli run "Organize files in ~/Downloads"`
3. Streams thinking updates and results back to the UI

## Installation

### 1. Install OpenCode CLI

```bash
# Using npm (recommended)
npm install -g opencode-ai

# Or using curl
curl -fsSL https://opencode.ai/install | bash

# Or using brew (macOS)
brew install opencode
```

### 2. Verify Installation

```bash
opencode --version
```

### 3. Set Up Your API Key

OpenCode needs an LLM provider. Set your OpenAI key:

```bash
export OPENAI_API_KEY=sk-your-key-here
```

## Configuration

### Environment Variables

Add these variables to your `.env` file:

```bash
# Enable OpenCode integration
OPENCODE_ENABLED=true

# IMPORTANT: Security - Specify allowed folders
# Only folders in this list can be accessed by the AI
OPENCODE_ALLOWED_FOLDERS=/Users/yourname/Documents,/Users/yourname/Downloads

# LLM Provider (uses your existing OPENAI_API_KEY by default)
OPENCODE_PROVIDER=openai
OPENCODE_MODEL=gpt-4o

# Optional: Custom CLI command (defaults to npx)
# OPENCODE_CLI=opencode
# OPENCODE_PACKAGE=  # Empty if using direct opencode command
```

### Optional: Additional Providers

If you want to use alternative LLM providers:

```bash
# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...
OPENCODE_PROVIDER=anthropic
OPENCODE_MODEL=claude-3-opus

# Google Gemini
GOOGLE_API_KEY=...
OPENCODE_PROVIDER=google
OPENCODE_MODEL=gemini-pro

# xAI Grok
XAI_API_KEY=...
OPENCODE_PROVIDER=xai
OPENCODE_MODEL=grok-1

# Ollama (local models)
OLLAMA_BASE_URL=http://localhost:11434
OPENCODE_PROVIDER=ollama
OPENCODE_MODEL=llama3
```

## Running OpenCode

### No Server Required!

Unlike the HTTP serve mode, CLI execution doesn't require a separate server process.
The system will call `npx @opencode/cli run` directly when needed.

### Testing CLI Manually

You can test OpenCode CLI directly:

```bash
# Test file organization
npx @opencode/cli run "List the files in ~/Downloads"

# Test with your API key
OPENAI_API_KEY=sk-your-key npx @opencode/cli run "What files are in my Documents folder?"
```

## Security Considerations

### Folder Permissions

**IMPORTANT**: The `OPENCODE_ALLOWED_FOLDERS` setting is crucial for security.

- Only specify folders you trust the AI to manage
- Use absolute paths
- Avoid system folders like `/`, `/usr`, `/etc`
- Recommended: Create a dedicated folder for AI-managed files

```bash
# Good - Specific user folders
OPENCODE_ALLOWED_FOLDERS=/Users/name/Documents,/Users/name/Projects

# BAD - Too permissive
OPENCODE_ALLOWED_FOLDERS=/Users/name  # Too broad
OPENCODE_ALLOWED_FOLDERS=/            # NEVER do this
```

### User Approval

All desktop actions are logged and can be reviewed. The reasoning steps UI shows exactly what operations are being performed.

## Usage Examples

Once configured, use natural language in the chat:

### File Management
- "Organize my downloads folder by file type"
- "Sort files in ~/Documents by date"
- "Move all PDFs to my archives folder"
- "Rename files in ~/Pictures with today's date"

### Document Creation
- "Create a project proposal for the new website"
- "Summarize the meeting notes in my documents"
- "Rewrite this report to be more formal"
- "Draft a memo about the quarterly results"

### Browser Automation
- "Research property prices in London"
- "Take a screenshot of example.com"
- "Find information about renewable energy trends"

## Troubleshooting

### OpenCode Not Connecting

1. Check if serve mode is running:
   ```bash
   curl http://localhost:3333/health
   ```

2. Check logs for errors:
   ```bash
   opencode serve --port 3333 2>&1 | tee opencode.log
   ```

3. Verify environment variables are loaded

### Permission Denied Errors

- Check `OPENCODE_ALLOWED_FOLDERS` includes the target folder
- Ensure the folder path is absolute
- Verify file system permissions

### LLM Errors

- Verify your API key is set correctly
- Check the provider supports the specified model
- For Ollama, ensure the model is pulled: `ollama pull llama3`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ SideChatPanel   │  │ ReasoningSteps (new action_types)│  │
│  └────────┬────────┘  └─────────────────────────────────┘  │
└───────────┼─────────────────────────────────────────────────┘
            │ query
            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Python/Flask)                   │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ main_graph.py   │──│ detect_desktop_intent_node      │  │
│  │ (LangGraph)     │  └─────────────────────────────────┘  │
│  └────────┬────────┘                                        │
│           │ desktop_action route                            │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ desktop_action_nodes.py                              │   │
│  │ handle_desktop_action()                              │   │
│  └────────┬────────────────────────────────────────────┘   │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ opencode_bridge.py                                   │   │
│  │ OpenCodeBridgeService                                │   │
│  └────────┬────────────────────────────────────────────┘   │
└───────────┼─────────────────────────────────────────────────┘
            │ HTTP API
            ▼
┌─────────────────────────────────────────────────────────────┐
│                 OpenCode CLI (serve mode)                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │ File Ops    │ │ Doc Create  │ │ Browser Automation  │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### OpenCode Bridge Endpoints (Internal)

The bridge service (`opencode_bridge.py`) communicates with OpenCode via:

- `POST /execute` - Execute a single action
- `POST /execute/stream` - Execute with streaming reasoning steps
- `GET /health` - Health check

### Desktop Action Types

| Category | Actions | Description |
|----------|---------|-------------|
| file_management | organize, sort, rename, move | File system operations |
| document_creation | create, summarize, rewrite | Document generation/transformation |
| browser_automation | research, form_fill, screenshot | Web automation |
