---
name: agent-package-release
description: "Generate agent-package.json and verify distribution artifacts for npm/tgz/git"
tags: [platform, release, distribution, packaging]
version: "1.0.0"
---

# Agent Package Release

## When to Use
When packaging the agent for distribution to nuwaclaw, generating the distribution manifest, or verifying the release artifacts.

## Distribution Manifest (`agent-package.json`)

### Template
```json
{
  "name": "my-scenario-agent",
  "version": "1.0.0",
  "description": "AI agent for [specific scenario]",
  "engine": "deepagents-app-ts",
  "source": {
    "type": "npm",
    "package": "@scope/my-scenario-agent",
    "registry": "https://registry.npmjs.org",
    "version": "1.0.0"
  },
  "bin": {
    "start": "dist/index.js"
  },
  "env": {
    "required": ["ANTHROPIC_API_KEY"],
    "optional": ["OPENAI_API_KEY"]
  },
  "mcp": {
    "servers": ["context7"]
  },
  "platform": {
    "agentId": "agent_xxx",
    "spaceId": "space_yyy"
  },
  "checksum": {
    "algorithm": "sha256",
    "value": "<computed-at-build>"
  }
}
```

### Source Types
| Type | Fields | Use Case |
|------|--------|----------|
| `npm` | package, registry, version | Standard distribution |
| `tgz` | url or path, sha256 | Customer-specific, offline |
| `git` | url, ref (branch/tag/commit) | Dev/preview, private repos |

## Release Process

### Step 1: Verify Build
```bash
npm run build
npm run typecheck
npm test
```

### Step 2: Update Manifest
- Set version number
- Update description
- Verify required env vars are listed
- Confirm bin entry point exists

### Step 3: Generate Checksum
```bash
bash scripts/package.sh
```
This creates the distributable artifact and computes the sha256 checksum.

### Step 4: Test Installation
Test each distribution method:
```bash
# npm
npm install @scope/my-scenario-agent
node node_modules/@scope/my-scenario-agent/dist/index.js

# tgz
npm install ./my-scenario-agent-1.0.0.tgz

# git
npm install git+https://github.com/org/my-scenario-agent.git#v1.0.0
```

### Step 5: Verify nuwaclaw Integration
- Confirm nuwaclaw can discover the `deepagents-app-ts` engine
- Verify the ACP server starts from the installed package
- Test a basic prompt through nuwaclaw

## Pre-Release Checklist
- [ ] All tests pass
- [ ] Build succeeds without errors
- [ ] `agent-package.json` is up to date
- [ ] Required env vars are documented
- [ ] MCP server dependencies are declared
- [ ] Platform agentId/spaceId are configured
- [ ] Checksum matches the artifact
- [ ] Installation works from the chosen source type
