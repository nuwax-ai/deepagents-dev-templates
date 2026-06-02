---
name: environment-discovery
description: "Systematic exploration of workspace, tools, and capabilities before acting"
tags: [discovery, exploration, setup]
version: "1.0.0"
---

# Environment Discovery

## When to Use
Use this skill BEFORE starting any significant task. Understanding the environment prevents wasted effort and wrong assumptions.

## Discovery Steps

### 1. Workspace Inspection
- List project files and directory structure
- Identify the project type (Node.js, web app, API, etc.)
- Check package.json for dependencies and scripts
- Read README.md or CLAUDE.md for project-specific instructions

### 2. Tool Availability
- Check which platform MCP tools are available (use platform_api query_plugins)
- Check which built-in tools are available
- Verify npm/node versions and available commands

### 3. Configuration Check
- Read config/app-agent.config.json for agent configuration
- Check .env or environment variables for API keys and settings
- Verify platform connection (agentId, spaceId)

### 4. Data & State
- Identify existing data files and their formats
- Check for any existing agent memory or state
- Note any test fixtures or sample data

### 5. Constraints
- Check file permissions (editable vs protected zones)
- Verify network access for external APIs
- Note any rate limits or quotas

## Output Format
After discovery, summarize findings:
```
## Environment Summary
- Project type: [type]
- Key files: [list]
- Available tools: [list]
- Platform connection: [status]
- Constraints: [list]
```

## Anti-patterns
- ❌ Starting implementation without checking existing code
- ❌ Assuming tool availability without verification
- ❌ Ignoring project conventions found in README/CLAUDE.md
