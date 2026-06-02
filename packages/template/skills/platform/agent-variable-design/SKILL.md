---
name: agent-variable-design
description: "Identify and create agent variables for API keys, config values, and secrets"
tags: [platform, variables, config, secrets]
version: "1.0.0"
---

# Agent Variable Design

## When to Use
When creating custom tools that need external credentials, API keys, base URLs, or any user-configurable values.

## What Qualifies as a Variable?
- API keys and tokens
- Base URLs for external services
- Tenant/organization IDs
- Feature flags
- Rate limit values
- Any value the user needs to configure without touching code

## Variable Naming Convention
- Use UPPER_SNAKE_CASE: `OPENAI_API_KEY`, `WEATHER_BASE_URL`
- Prefix with service name: `SLACK_BOT_TOKEN`, `GITHUB_PAT`
- Be descriptive: `AWS_REGION` not just `REGION`

## Process

### Step 1: Identify Variables
When writing a tool, look for:
```typescript
// ❌ WRONG — hardcoded
const API_KEY = "sk-abc123...";
const BASE_URL = "https://api.openai.com/v1";

// ✅ RIGHT — use variables
const API_KEY = await variableManager.get("OPENAI_API_KEY");
const BASE_URL = await variableManager.get("OPENAI_BASE_URL");
```

### Step 2: Create Variables
```
agent_variable(
  operation: "create",
  name: "OPENAI_API_KEY",
  description: "OpenAI API key for GPT model access",
  type: "secret",        // hidden in UI
  required: true         // agent won't start without it
)
```

### Step 3: Document Variables
Add to the tool's description or README:
```
## Required Variables
| Name | Type | Description |
|------|------|-------------|
| OPENAI_API_KEY | secret | OpenAI API key |
| OPENAI_BASE_URL | string | API endpoint (default: https://api.openai.com/v1) |
```

## Variable Types
| Type | Use For | UI Behavior |
|------|---------|-------------|
| `string` | Plain text values | Visible |
| `secret` | API keys, tokens | Hidden (•••) |
| `number` | Numeric values | Number input |
| `boolean` | Feature flags | Toggle |

## Best Practices
- Always set `required: true` for essential credentials
- Provide `defaultValue` for optional config with sensible defaults
- Group related variables with common prefixes
- Use `secret` type for anything sensitive
