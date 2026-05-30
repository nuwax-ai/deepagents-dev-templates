---
name: platform-capability-discovery
description: "Discover what the Nuwax platform offers: plugins, workflows, APIs, and component bindings"
tags: [platform, discovery, capabilities, plugins]
version: "1.0.0"
---

# Platform Capability Discovery

## When to Use
At project initialization, or when you need to understand what the Nuwax platform can provide for the agent being built.

## Discovery Process

### Step 1: Check Platform Connection
```
platform_api(operation: "query_plugins", params: { query: "" })
```
If this fails, the platform connection is not configured. Check:
- `PLATFORM_API_TOKEN` environment variable
- `PLATFORM_AGENT_ID` and `PLATFORM_SPACE_ID`
- `config/platform.json` settings

### Step 2: Discover Plugin Categories
Search for common plugin types:
```
platform_api(operation: "query_plugins", params: { query: "email", type: "mcp" })
platform_api(operation: "query_plugins", params: { query: "database", type: "api" })
platform_api(operation: "query_plugins", params: { query: "notification", type: "workflow" })
```

### Step 3: Map Capabilities
Build a capability map:
```
## Platform Capabilities
### MCP Plugins (direct tool use)
- weather-service: Weather data API
- email-sender: Send emails via SMTP/API
- doc-parser: Parse documents (PDF, DOCX)

### API Plugins (callable via platform_api)
- crm-connector: CRM system integration
- analytics: Usage analytics

### Workflows (multi-step processes)
- data-pipeline: ETL workflow
- approval-flow: Human approval process

### Component Bindings
- knowledge-base: RAG knowledge base
- form-builder: Dynamic form generation
```

### Step 4: Plan Integration
For each needed capability:
1. Is there a platform plugin? → Use it
2. Can it be configured as MCP? → Add to MCP config
3. Is it an API? → Use platform_api execute_plugin
4. None of the above? → Write custom tool

## Output Format
Document findings in a structured format:
```markdown
## Platform Integration Plan
| Need | Platform Solution | Integration Method |
|------|------------------|-------------------|
| Send email | nuwax-email-plugin | MCP tool |
| Parse PDF | doc-parser | API plugin |
| Custom analytics | None available | Custom tool + variable |
```

## Anti-patterns
- ❌ Writing custom integrations without checking platform first
- ❌ Assuming platform capabilities that haven't been verified
- ❌ Hardcoding platform-specific details in runtime code
